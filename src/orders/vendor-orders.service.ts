import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderActorType, Prisma } from '@prisma/client';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { VendorsService } from '../vendors/vendors.service';
import { VendorListOrdersQueryDto, VendorOrderDto } from './dto';
import { toVendorOrder, vendorSubOrderInclude } from './order.mapper';
import { ORDER_NOT_FOUND, TransitionAction } from './order-status';
import { SubOrderTransitionsService } from './sub-order-transitions.service';

/**
 * A shop's own sub-orders (FR-017–021), in any shop status, including SUSPENDED. Other shops'
 * sub-orders are 404.
 */
@Injectable()
export class VendorOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: VendorsService,
    private readonly transitions: SubOrderTransitionsService,
  ) {}

  async list(userId: string, q: VendorListOrdersQueryDto): Promise<Paginated<VendorOrderDto>> {
    const { id: vendorId } = await this.vendors.findMine(userId);
    const where: Prisma.SubOrderWhereInput = {
      vendorId,
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subOrder.findMany({
        where,
        include: vendorSubOrderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(q),
      }),
      this.prisma.subOrder.count({ where }),
    ]);
    return paginate(rows.map(toVendorOrder), total, q);
  }

  async get(userId: string, id: string): Promise<VendorOrderDto> {
    const { id: vendorId } = await this.vendors.findMine(userId);
    return this.load(vendorId, id);
  }

  confirm(userId: string, id: string): Promise<VendorOrderDto> {
    return this.act(userId, id, 'confirm');
  }

  dispatch(userId: string, id: string): Promise<VendorOrderDto> {
    return this.act(userId, id, 'dispatch');
  }

  /** Also records that the cash was collected (FR-019). */
  deliver(userId: string, id: string): Promise<VendorOrderDto> {
    return this.act(userId, id, 'deliver');
  }

  reject(userId: string, id: string, reason: string): Promise<VendorOrderDto> {
    return this.act(userId, id, 'reject', reason);
  }

  cancel(userId: string, id: string, reason: string): Promise<VendorOrderDto> {
    return this.act(userId, id, 'cancel', reason);
  }

  private async act(
    userId: string,
    id: string,
    action: TransitionAction,
    reason?: string,
  ): Promise<VendorOrderDto> {
    const { id: vendorId } = await this.vendors.findMine(userId);
    await this.transitions.apply({
      subOrderId: id,
      where: { vendorId },
      actorType: OrderActorType.VENDOR,
      actorId: userId,
      action,
      reason,
    });
    return this.load(vendorId, id);
  }

  private async load(vendorId: string, id: string): Promise<VendorOrderDto> {
    const sub = await this.prisma.subOrder.findFirst({
      where: { id, vendorId },
      include: vendorSubOrderInclude,
    });
    if (!sub) throw new NotFoundException(ORDER_NOT_FOUND);
    return toVendorOrder(sub);
  }
}
