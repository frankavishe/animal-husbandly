import { NotFoundException } from '@nestjs/common';
import { orderFixture } from './order.fixtures-spec';
import { OrdersService } from './orders.service';

const USER = 'customer-1';

describe('OrdersService', () => {
  let prisma: any;
  let transitions: { apply: jest.Mock };
  let service: OrdersService;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([orderFixture()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(orderFixture()),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    transitions = { apply: jest.fn().mockResolvedValue({}) };
    service = new OrdersService(prisma, transitions as any);
  });

  describe('list', () => {
    it('lists only own orders, newest first, paginated', async () => {
      const page = await service.list(USER, { page: 3, limit: 5 });
      const args = prisma.order.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ customerId: USER });
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { seq: 'desc' }]);
      expect([args.skip, args.take]).toEqual([10, 5]);
      expect(page).toMatchObject({ page: 3, limit: 5, total: 1 });
      expect(page.items[0].orderNumber).toBe('ORD-00000042');
    });

    it.each(['OPEN', 'COMPLETED', 'CANCELLED'] as const)(
      'filters by overall status %s with the derived rule',
      async (status) => {
        await service.list(USER, { page: 1, limit: 20, status });
        const where = prisma.order.findMany.mock.calls[0][0].where;
        expect(where.customerId).toBe(USER);
        expect(where.subOrders ?? where.AND).toBeDefined();
        expect(prisma.order.count.mock.calls[0][0].where).toEqual(where);
      },
    );
  });

  describe('get', () => {
    it("scopes by customer and 404s for others' orders", async () => {
      await service.get(USER, 'order-1');
      expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({
        id: 'order-1',
        customerId: USER,
      });
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.get('someone', 'order-1')).rejects.toThrow(
        new NotFoundException('Order not found'),
      );
    });
  });

  describe('cancelSubOrder', () => {
    it('applies the customer cancel scoped to the order and its customer', async () => {
      const result = await service.cancelSubOrder(USER, 'order-1', 'sub-0', 'Changed my mind');
      expect(transitions.apply).toHaveBeenCalledWith({
        subOrderId: 'sub-0',
        where: { orderId: 'order-1', order: { customerId: USER } },
        actorType: 'CUSTOMER',
        actorId: USER,
        action: 'cancel',
        reason: 'Changed my mind',
      });
      expect(result.id).toBe('order-1');
    });

    it('passes no reason when none is given', async () => {
      await service.cancelSubOrder(USER, 'order-1', 'sub-0');
      expect(transitions.apply.mock.calls[0][0].reason).toBeUndefined();
    });
  });
});
