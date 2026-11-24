import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma, Vendor, VendorStatus } from '@prisma/client';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { StorageService } from '../common/storage';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_VENDOR_WHERE, SHOP_SUSPENDED, VendorsService } from '../vendors/vendors.service';
import {
  CreateListingDto,
  ListingSort,
  OwnerListingDto,
  PublicListingDto,
  PublicListListingsQueryDto,
  UpdateListingDto,
  VendorListListingsQueryDto,
} from './dto';
import { ListingRuleInput, validateListing } from './listing-rules';
import {
  listingInclude,
  ListingWithRelations,
  toOwnerListing,
  toPublicListing,
} from './listing.mapper';

export const LISTING_NOT_FOUND = 'Listing not found';
export const SHOP_NOT_APPROVED = 'Your shop is not approved';

/** FR-014: creating, editing, publishing/activating and photo changes need an APPROVED shop. */
export function assertShopApproved(vendor: Pick<Vendor, 'status'>): void {
  if (vendor.status === VendorStatus.SUSPENDED) throw new ForbiddenException(SHOP_SUSPENDED);
  if (vendor.status !== VendorStatus.APPROVED) throw new ForbiddenException(SHOP_NOT_APPROVED);
}

export function cannot(action: string, status: ListingStatus): ConflictException {
  return new ConflictException(`Cannot ${action} a listing that is ${status}`);
}

const ORDER_BY: Record<ListingSort, Prisma.ListingOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: 'desc' }, { id: 'asc' }],
  price_asc: [{ unitPrice: 'asc' }, { id: 'asc' }],
  price_desc: [{ unitPrice: 'desc' }, { id: 'asc' }],
};

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: VendorsService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- vendor: details (US1)

  async create(userId: string, dto: CreateListingDto): Promise<OwnerListingDto> {
    const vendor = await this.vendors.findMine(userId);
    assertShopApproved(vendor);
    this.assertShopSpecies(vendor, dto.species);
    validateListing(dto);
    const listing = await this.prisma.listing.create({
      data: {
        vendorId: vendor.id,
        title: dto.title,
        description: dto.description ?? '',
        species: dto.species,
        listingType: dto.listingType,
        unit: dto.unit,
        unitPrice: dto.unitPrice,
        stockQuantity: dto.stockQuantity,
        breed: dto.breed ?? null,
        sex: dto.sex ?? null,
        ageMonths: dto.ageMonths ?? null,
        weightKg: dto.weightKg ?? null,
      },
      include: listingInclude,
    });
    return this.toOwner(listing);
  }

  async listMine(
    userId: string,
    q: VendorListListingsQueryDto,
  ): Promise<Paginated<OwnerListingDto>> {
    const vendor = await this.vendors.findMine(userId);
    const where: Prisma.ListingWhereInput = {
      vendorId: vendor.id,
      status: q.status ?? { not: ListingStatus.ARCHIVED },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(q),
      }),
      this.prisma.listing.count({ where }),
    ]);
    return paginate(
      rows.map((l) => this.toOwner(l)),
      total,
      q,
    );
  }

  async getMine(userId: string, id: string): Promise<OwnerListingDto> {
    const vendor = await this.vendors.findMine(userId);
    return this.toOwner(await this.findOwn(vendor.id, id));
  }

  async updateMine(userId: string, id: string, dto: UpdateListingDto): Promise<OwnerListingDto> {
    const vendor = await this.vendors.findMine(userId);
    const current = await this.findOwn(vendor.id, id);
    if (current.status === ListingStatus.ARCHIVED) throw cannot('edit', current.status);
    assertShopApproved(vendor);

    const speciesChanged = dto.species != null && dto.species !== current.species;
    const typeChanged = dto.listingType != null && dto.listingType !== current.listingType;
    if ((speciesChanged || typeChanged) && current.status !== ListingStatus.DRAFT) {
      throw new ConflictException(
        `Species and listing type can only be changed while the listing is DRAFT (current: ${current.status})`,
      );
    }
    if (speciesChanged) this.assertShopSpecies(vendor, dto.species!);

    // `undefined` keeps the stored value; `null` clears the optional live-animal fields.
    const keep = <T>(sent: T | null | undefined, stored: T | null): T | null =>
      sent === undefined ? stored : sent;
    const merged: ListingRuleInput = {
      species: dto.species ?? current.species,
      listingType: dto.listingType ?? current.listingType,
      unit: dto.unit ?? current.unit,
      breed: keep(dto.breed, current.breed),
      sex: keep(dto.sex, current.sex),
      ageMonths: keep(dto.ageMonths, current.ageMonths),
      weightKg: keep(dto.weightKg, current.weightKg == null ? null : Number(current.weightKg)),
    };
    validateListing(merged);

    const data: Prisma.ListingUncheckedUpdateInput = {
      ...merged,
      breed: merged.breed ?? null,
      sex: merged.sex ?? null,
      ageMonths: merged.ageMonths ?? null,
      weightKg: merged.weightKg ?? null,
    };
    if (dto.title != null) data.title = dto.title;
    if (dto.description != null) data.description = dto.description;
    if (dto.unitPrice != null) data.unitPrice = dto.unitPrice;
    if (dto.stockQuantity != null) data.stockQuantity = dto.stockQuantity;

    const updated = await this.prisma.listing.update({
      where: { id: current.id },
      data,
      include: listingInclude,
    });
    return this.toOwner(updated);
  }

  // ---------------------------------------------------------------- vendor: lifecycle (US2)

  publish(userId: string, id: string): Promise<OwnerListingDto> {
    return this.transition(userId, id, 'publish', [ListingStatus.DRAFT], {
      requireApproved: true,
      data: { status: ListingStatus.ACTIVE, publishedAt: new Date() },
    });
  }

  pause(userId: string, id: string): Promise<OwnerListingDto> {
    return this.transition(userId, id, 'pause', [ListingStatus.ACTIVE], {
      requireApproved: false,
      data: { status: ListingStatus.INACTIVE },
    });
  }

  /** Keeps the original `publishedAt`; a restored, never-published listing gets one now (R9). */
  activate(userId: string, id: string): Promise<OwnerListingDto> {
    return this.transition(userId, id, 'activate', [ListingStatus.INACTIVE], {
      requireApproved: true,
      data: { status: ListingStatus.ACTIVE },
      stampPublishedAt: true,
    });
  }

  archive(userId: string, id: string): Promise<OwnerListingDto> {
    return this.transition(
      userId,
      id,
      'archive',
      [ListingStatus.DRAFT, ListingStatus.ACTIVE, ListingStatus.INACTIVE, ListingStatus.TAKEN_DOWN],
      { requireApproved: false, data: { status: ListingStatus.ARCHIVED, archivedAt: new Date() } },
    );
  }

  /** Race-safe conditional update (R4): one winner, everyone else gets 409 naming the status. */
  private async transition(
    userId: string,
    id: string,
    action: string,
    from: ListingStatus[],
    opts: {
      requireApproved: boolean;
      data: Prisma.ListingUpdateManyMutationInput;
      stampPublishedAt?: boolean;
    },
  ): Promise<OwnerListingDto> {
    const vendor = await this.vendors.findMine(userId);
    if (opts.requireApproved) assertShopApproved(vendor);
    const own = { id, vendorId: vendor.id };
    const operations = [
      this.prisma.listing.updateMany({
        where: { ...own, status: { in: from } },
        data: opts.data,
      }),
    ];
    if (opts.stampPublishedAt) {
      operations.push(
        this.prisma.listing.updateMany({
          where: { ...own, status: ListingStatus.ACTIVE, publishedAt: null },
          data: { publishedAt: new Date() },
        }),
      );
    }
    const [{ count }] = await this.prisma.$transaction(operations);
    const listing = await this.findOwn(vendor.id, id);
    if (count === 0) throw cannot(action, listing.status);
    return this.toOwner(listing);
  }

  // ---------------------------------------------------------------- public (US3)

  async listPublic(q: PublicListListingsQueryDto): Promise<Paginated<PublicListingDto>> {
    if (q.minPrice != null && q.maxPrice != null && q.minPrice > q.maxPrice) {
      throw new BadRequestException('minPrice must not exceed maxPrice');
    }
    const where = ListingsService.publicWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: ListingsService.publicOrderBy(q.sort),
        ...toSkipTake(q),
      }),
      this.prisma.listing.count({ where }),
    ]);
    return paginate(
      rows.map((l) => toPublicListing(l, this.storage)),
      total,
      q,
    );
  }

  async getPublic(id: string): Promise<PublicListingDto> {
    const listing = await this.prisma.listing.findFirst({
      where: { id, status: ListingStatus.ACTIVE, vendor: PUBLIC_VENDOR_WHERE },
      include: listingInclude,
    });
    if (!listing) throw new NotFoundException(LISTING_NOT_FOUND);
    return toPublicListing(listing, this.storage);
  }

  static publicWhere(q: Partial<PublicListListingsQueryDto>): Prisma.ListingWhereInput {
    const vendor: Prisma.VendorWhereInput = { ...PUBLIC_VENDOR_WHERE };
    if (q.regionId) vendor.regionId = q.regionId;
    if (q.districtId) vendor.districtId = q.districtId;
    if (q.shop) vendor.slug = q.shop;

    const where: Prisma.ListingWhereInput = { status: ListingStatus.ACTIVE, vendor };
    if (q.species) where.species = q.species;
    if (q.listingType) where.listingType = q.listingType;
    if (q.minPrice != null || q.maxPrice != null) {
      where.unitPrice = {
        ...(q.minPrice != null && { gte: q.minPrice }),
        ...(q.maxPrice != null && { lte: q.maxPrice }),
      };
    }
    if (q.inStock) where.stockQuantity = { gt: 0 };
    if (q.search) {
      where.OR = [
        { title: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  static publicOrderBy(sort: ListingSort = 'newest'): Prisma.ListingOrderByWithRelationInput[] {
    return ORDER_BY[sort];
  }

  // ---------------------------------------------------------------- helpers

  /** A listing of `vendorId`, or 404 (other shops' listings are never revealed, FR-009). */
  private async findOwn(vendorId: string, id: string): Promise<ListingWithRelations> {
    const listing = await this.prisma.listing.findFirst({
      where: { id, vendorId },
      include: listingInclude,
    });
    if (!listing) throw new NotFoundException(LISTING_NOT_FOUND);
    return listing;
  }

  /** FR-004: only checked when species is set or changed. */
  private assertShopSpecies(vendor: Pick<Vendor, 'species'>, species: Vendor['species'][number]) {
    if (!vendor.species.includes(species)) {
      throw new BadRequestException(`Your shop does not deal in ${species}`);
    }
  }

  private toOwner(l: ListingWithRelations): OwnerListingDto {
    return toOwnerListing(l, this.storage);
  }
}
