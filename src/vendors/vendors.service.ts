import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, Vendor, VendorStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthUser } from '../common/decorators';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { StorageService } from '../common/storage';
import { detectImageType } from '../common/utils/image';
import { PrismaService } from '../prisma/prisma.service';
import { RegionsService } from '../users/regions.service';
import {
  ApplyVendorDto,
  OwnerVendorDto,
  PublicListVendorsQueryDto,
  PublicVendorDto,
  UpdateVendorDto,
} from './dto';
import { slugify } from './slug';
import { toOwnerVendor, toPublicVendor, vendorInclude, VendorWithRelations } from './vendor.mapper';

export const NO_SHOP = 'You do not have a shop';
export const SHOP_SUSPENDED = 'Your shop is suspended';

/** Minimal shape of an uploaded file (multer memory storage). */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/** Visibility rule for anonymous browsing (FR-016/018); also used for public listings. */
export const PUBLIC_VENDOR_WHERE: Prisma.VendorWhereInput = {
  status: VendorStatus.APPROVED,
  user: { isActive: true },
};

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly regions: RegionsService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- owner: profile (US1)

  async apply(user: AuthUser, dto: ApplyVendorDto): Promise<OwnerVendorDto> {
    if (user.role !== Role.CUSTOMER) {
      throw new ForbiddenException('Only customers can apply to open a shop');
    }
    const existing = await this.prisma.vendor.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (existing) throw new ConflictException('You already have a shop');

    await this.regions.assertDistrictInRegion(dto.regionId, dto.districtId);
    const base = slugify(dto.shopName);
    if (!base) throw new BadRequestException('Shop name must contain letters or digits');

    const data = (slug: string): Prisma.VendorUncheckedCreateInput => ({
      userId: user.id,
      shopName: dto.shopName,
      slug,
      description: dto.description ?? '',
      regionId: dto.regionId,
      districtId: dto.districtId,
      businessPhone: dto.businessPhone,
      species: dto.species,
    });

    let slug = await this.nextFreeSlug(base);
    try {
      return this.toOwner(
        await this.prisma.vendor.create({ data: data(slug), include: vendorInclude }),
      );
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (uniqueTarget(e).includes('user_id'))
        throw new ConflictException('You already have a shop');
      // A concurrent application took the same slug: retry once with the next free suffix.
      slug = await this.nextFreeSlug(base);
      return this.toOwner(
        await this.prisma.vendor.create({ data: data(slug), include: vendorInclude }),
      );
    }
  }

  async getMine(userId: string): Promise<OwnerVendorDto> {
    return this.toOwner(await this.findMine(userId));
  }

  async updateMine(userId: string, dto: UpdateVendorDto): Promise<OwnerVendorDto> {
    const current = await this.findMine(userId);
    this.assertEditable(current);
    if (dto.regionId != null || dto.districtId != null) {
      await this.regions.assertDistrictInRegion(
        dto.regionId ?? current.regionId,
        dto.districtId ?? current.districtId,
      );
    }
    // `null` from PATCH means "not sent" for these required fields; the slug never changes (FR-005).
    const data: Prisma.VendorUncheckedUpdateInput = {};
    if (dto.shopName != null) data.shopName = dto.shopName;
    if (dto.description != null) data.description = dto.description;
    if (dto.regionId != null) data.regionId = dto.regionId;
    if (dto.districtId != null) data.districtId = dto.districtId;
    if (dto.businessPhone != null) data.businessPhone = dto.businessPhone;
    if (dto.species != null) data.species = dto.species;
    const updated = await this.prisma.vendor.update({
      where: { id: current.id },
      data,
      include: vendorInclude,
    });
    return this.toOwner(updated);
  }

  /** FR-008: REJECTED → PENDING only. */
  async resubmit(userId: string): Promise<OwnerVendorDto> {
    const current = await this.findMine(userId);
    const { count } = await this.prisma.vendor.updateMany({
      where: { id: current.id, status: VendorStatus.REJECTED },
      data: { status: VendorStatus.PENDING, rejectionReason: null, submittedAt: new Date() },
    });
    if (count === 0) {
      throw new ConflictException(`Cannot resubmit a shop that is ${current.status}`);
    }
    return this.getMine(userId);
  }

  // ---------------------------------------------------------------- owner: logo (US4)

  async setLogo(userId: string, file: UploadedImage | undefined): Promise<OwnerVendorDto> {
    if (!file?.buffer?.length) throw new BadRequestException('A logo file is required');
    const current = await this.findMine(userId);
    this.assertEditable(current);
    const type = detectImageType(file.buffer);
    if (!type) throw new BadRequestException('Logo must be a JPEG, PNG or WebP image');

    const key = `vendors/${current.id}/logo-${randomUUID()}.${type.ext}`;
    // Upload first: if it fails, the previous logo stays in place (FR-021).
    await this.storage.put(key, file.buffer, type.mime);
    const updated = await this.prisma.vendor.update({
      where: { id: current.id },
      data: { logoKey: key },
      include: vendorInclude,
    });
    await this.deleteQuietly(current.logoKey);
    return this.toOwner(updated);
  }

  async removeLogo(userId: string): Promise<OwnerVendorDto> {
    const current = await this.findMine(userId);
    this.assertEditable(current);
    const updated = await this.prisma.vendor.update({
      where: { id: current.id },
      data: { logoKey: null },
      include: vendorInclude,
    });
    await this.deleteQuietly(current.logoKey);
    return this.toOwner(updated);
  }

  // ---------------------------------------------------------------- public (US3)

  async listPublic(q: PublicListVendorsQueryDto): Promise<Paginated<PublicVendorDto>> {
    const where = VendorsService.publicWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        include: vendorInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(q),
      }),
      this.prisma.vendor.count({ where }),
    ]);
    return paginate(
      rows.map((v) => toPublicVendor(v, this.storage)),
      total,
      q,
    );
  }

  async getPublicBySlug(slug: string): Promise<PublicVendorDto> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { ...PUBLIC_VENDOR_WHERE, slug },
      include: vendorInclude,
    });
    if (!vendor) throw new NotFoundException('Shop not found');
    return toPublicVendor(vendor, this.storage);
  }

  static publicWhere(q: PublicListVendorsQueryDto): Prisma.VendorWhereInput {
    const where: Prisma.VendorWhereInput = { ...PUBLIC_VENDOR_WHERE };
    if (q.regionId) where.regionId = q.regionId;
    if (q.districtId) where.districtId = q.districtId;
    if (q.species) where.species = { has: q.species };
    if (q.search) where.shopName = { contains: q.search, mode: 'insensitive' };
    return where;
  }

  // ---------------------------------------------------------------- shared helpers

  /** The caller's shop, or 404. */
  async findMine(userId: string): Promise<VendorWithRelations> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
      include: vendorInclude,
    });
    if (!vendor) throw new NotFoundException(NO_SHOP);
    return vendor;
  }

  /** Owners may edit PENDING, REJECTED and APPROVED shops, never SUSPENDED ones (FR-007). */
  assertEditable(vendor: Pick<Vendor, 'status'>): void {
    if (vendor.status === VendorStatus.SUSPENDED) throw new ForbiddenException(SHOP_SUSPENDED);
  }

  /** `base` if free, otherwise `base-N` with N = highest existing suffix + 1 (min 2). */
  private async nextFreeSlug(base: string): Promise<string> {
    const taken = await this.prisma.vendor.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const pattern = new RegExp(`^${base}(?:-(\\d+))?$`);
    let max = 0;
    for (const { slug } of taken) {
      const m = pattern.exec(slug);
      if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1);
    }
    return max === 0 ? base : `${base}-${max + 1}`;
  }

  private async deleteQuietly(key: string | null): Promise<void> {
    if (!key) return;
    try {
      await this.storage.delete(key);
    } catch (e) {
      this.logger.warn(`Failed to delete old logo ${key}: ${(e as Error).message}`);
    }
  }

  private toOwner(v: VendorWithRelations): OwnerVendorDto {
    return toOwnerVendor(v, this.storage);
  }
}

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function uniqueTarget(e: Prisma.PrismaClientKnownRequestError): string {
  const t = e.meta?.target as string[] | string | undefined;
  return Array.isArray(t) ? t.join(',') : (t ?? '');
}
