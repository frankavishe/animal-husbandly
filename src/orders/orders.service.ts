import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerOrderDto } from './dto';
import { orderInclude, toCustomerOrder } from './order.mapper';
import { ORDER_NOT_FOUND } from './order-status';

/** A customer's own orders (FR-022–025); other customers' orders are 404. */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, id: string): Promise<CustomerOrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: userId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return toCustomerOrder(order);
  }
}
