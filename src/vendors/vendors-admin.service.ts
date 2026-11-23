import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, VendorStatus } from '@prisma/client';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { StorageService } from '../common/storage';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListVendorsQueryDto, AdminVendorDto } from './dto';
import { toAdminVendor, vendorInclude } from './vendor.mapper';

export type AdminAction = 'approve' | 'reject' | 'suspend' | 'reactivate';

/** The only status changes an admin may make (FR-011..FR-014). */
export const ADMIN_TRANSITIONS: Record<AdminAction, { from: VendorStatus; to: VendorStatus }> = {
  approve: { from: VendorStatus.PENDING, to: VendorStatus.APPROVED },
  reject: { from: VendorStatus.PENDING, to: VendorStatus.REJECTED },
  suspend: { from: VendorStatus.APPROVED, to: VendorStatus.SUSPENDED },
  reactivate: { from: VendorStatus.SUSPENDED, to: VendorStatus.APPROVED },
};

@Injectable()
export class VendorsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(q: AdminListVendorsQueryDto): Promise<Paginated<AdminVendorDto>> {
    const where = VendorsAdminService.listWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        include: vendorInclude,
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(q),
      }),
      this.prisma.vendor.count({ where }),
    ]);
    return paginate(
      rows.map((v) => toAdminVendor(v, this.storage)),
      total,
      q,
    );
  }

  static listWhere(q: AdminListVendorsQueryDto): Prisma.VendorWhereInput {
    const where: Prisma.VendorWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.search) where.shopName = { contains: q.search, mode: 'insensitive' };
    return where;
  }

  async get(id: string): Promise<AdminVendorDto> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id }, include: vendorInclude });
    if (!vendor) throw new NotFoundException('Shop not found');
    return toAdminVendor(vendor, this.storage);
  }

  /** PENDING → APPROVED and owner role → VENDOR, atomically (FR-011). */
  approve(adminId: string, id: string): Promise<AdminVendorDto> {
    return this.transition(adminId, id, 'approve', {}, async (tx, vendor) => {
      const owner = await tx.user.findUniqueOrThrow({
        where: { id: vendor.userId },
        select: { isActive: true },
      });
      if (!owner.isActive) throw new ConflictException('Owner account is deactivated');
      await tx.user.update({ where: { id: vendor.userId }, data: { role: Role.VENDOR } });
    });
  }

  reject(adminId: string, id: string, reason: string): Promise<AdminVendorDto> {
    return this.transition(adminId, id, 'reject', { rejectionReason: reason });
  }

  suspend(adminId: string, id: string): Promise<AdminVendorDto> {
    return this.transition(adminId, id, 'suspend', {});
  }

  reactivate(adminId: string, id: string): Promise<AdminVendorDto> {
    return this.transition(adminId, id, 'reactivate', {});
  }

  /**
   * Applies one transition with a conditional update (`WHERE status = from`) so concurrent admin
   * actions cannot both succeed; refuses with 409 naming the current status otherwise.
   */
  private async transition(
    adminId: string,
    id: string,
    action: AdminAction,
    extra: Prisma.VendorUncheckedUpdateManyInput,
    sideEffect?: (tx: Prisma.TransactionClient, vendor: { userId: string }) => Promise<void>,
  ): Promise<AdminVendorDto> {
    const { from, to } = ADMIN_TRANSITIONS[action];
    await this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findUnique({
        where: { id },
        select: { status: true, userId: true },
      });
      if (!vendor) throw new NotFoundException('Shop not found');
      if (vendor.status !== from) {
        throw new ConflictException(`Cannot ${action} a shop that is ${vendor.status}`);
      }
      if (sideEffect) await sideEffect(tx, vendor);
      const { count } = await tx.vendor.updateMany({
        where: { id, status: from },
        data: { ...extra, status: to, reviewedById: adminId, reviewedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException(`Cannot ${action} a shop that is no longer ${from}`);
      }
    });
    return this.get(id);
  }
}
