import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderActorType, Prisma } from '@prisma/client';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListOrdersQueryDto, AdminOrderDto } from './dto';
import { orderInclude, toAdminOrder } from './order.mapper';
import { ORDER_NOT_FOUND, overallStatusWhere } from './order-status';
import { SubOrderTransitionsService } from './sub-order-transitions.service';

const DAY = 86_400_000;

/** Order administration (FR-026–027). */
@Injectable()
export class OrdersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: SubOrderTransitionsService,
  ) {}

  async list(q: AdminListOrdersQueryDto): Promise<Paginated<AdminOrderDto>> {
    const where = OrdersAdminService.listWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
        ...toSkipTake(q),
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(rows.map(toAdminOrder), total, q);
  }

  /**
   * Every filter narrows the result. Dates are UTC days: `from` from its start, `to` to its end.
   * `subOrderStatus` with `vendorId` must match the same sub-order.
   */
  static listWhere(q: Partial<AdminListOrdersQueryDto>): Prisma.OrderWhereInput {
    const and: Prisma.OrderWhereInput[] = [];
    if (q.status) and.push(overallStatusWhere(q.status));
    if (q.customerId) and.push({ customerId: q.customerId });
    if (q.vendorId || q.subOrderStatus) {
      and.push({
        subOrders: {
          some: {
            ...(q.vendorId ? { vendorId: q.vendorId } : {}),
            ...(q.subOrderStatus ? { status: q.subOrderStatus } : {}),
          },
        },
      });
    }
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : undefined;
    const toExclusive = q.to
      ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + DAY)
      : undefined;
    if (from && toExclusive && from >= toExclusive) {
      throw new BadRequestException('from must not be after to');
    }
    if (from || toExclusive) {
      and.push({
        createdAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) },
      });
    }
    return and.length ? { AND: and } : {};
  }

  async get(id: string): Promise<AdminOrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return toAdminOrder(order);
  }

  /** PENDING, CONFIRMED or DISPATCHED → CANCELLED; stock returns except from DISPATCHED. */
  async cancelSubOrder(
    adminId: string,
    orderId: string,
    subOrderId: string,
    reason: string,
  ): Promise<AdminOrderDto> {
    await this.transitions.apply({
      subOrderId,
      where: { orderId },
      actorType: OrderActorType.ADMIN,
      actorId: adminId,
      action: 'cancel',
      reason,
    });
    return this.get(orderId);
  }
}
