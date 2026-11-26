import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderActorType, Prisma } from '@prisma/client';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerListOrdersQueryDto, CustomerOrderDto } from './dto';
import { orderInclude, toCustomerOrder } from './order.mapper';
import { ORDER_NOT_FOUND, overallStatusWhere } from './order-status';
import { SubOrderTransitionsService } from './sub-order-transitions.service';

/** A customer's own orders (FR-022–025); other customers' orders are 404. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: SubOrderTransitionsService,
  ) {}

  async list(userId: string, q: CustomerListOrdersQueryDto): Promise<Paginated<CustomerOrderDto>> {
    const where: Prisma.OrderWhereInput = {
      customerId: userId,
      ...(q.status ? overallStatusWhere(q.status) : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
        ...toSkipTake(q),
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(rows.map(toCustomerOrder), total, q);
  }

  async get(userId: string, id: string): Promise<CustomerOrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: userId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return toCustomerOrder(order);
  }

  /** PENDING → CANCELLED with an optional reason; stock returns (FR-024). */
  async cancelSubOrder(
    userId: string,
    orderId: string,
    subOrderId: string,
    reason?: string,
  ): Promise<CustomerOrderDto> {
    await this.transitions.apply({
      subOrderId,
      where: { orderId, order: { customerId: userId } },
      actorType: OrderActorType.CUSTOMER,
      actorId: userId,
      action: 'cancel',
      reason,
    });
    return this.get(userId, orderId);
  }
}
