import { BadRequestException, NotFoundException } from '@nestjs/common';
import { orderFixture } from './order.fixtures-spec';
import { OrdersAdminService } from './orders-admin.service';

const OPEN = { in: ['PENDING', 'CONFIRMED', 'DISPATCHED'] };

describe('OrdersAdminService', () => {
  describe('listWhere', () => {
    const where = (q: object) => OrdersAdminService.listWhere(q);

    it('is empty without filters', () => {
      expect(where({})).toEqual({});
    });

    it('composes every filter with AND', () => {
      expect(
        where({ status: 'OPEN', customerId: 'c1', vendorId: 'v1', subOrderStatus: 'CONFIRMED' }),
      ).toEqual({
        AND: [
          { subOrders: { some: { status: OPEN } } },
          { customerId: 'c1' },
          { subOrders: { some: { vendorId: 'v1', status: 'CONFIRMED' } } },
        ],
      });
    });

    it('matches vendor or sub-order status alone', () => {
      expect(where({ vendorId: 'v1' })).toEqual({
        AND: [{ subOrders: { some: { vendorId: 'v1' } } }],
      });
      expect(where({ subOrderStatus: 'DELIVERED' })).toEqual({
        AND: [{ subOrders: { some: { status: 'DELIVERED' } } }],
      });
    });

    it('treats dates as whole UTC days, inclusive', () => {
      expect(where({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
        AND: [
          {
            createdAt: {
              gte: new Date('2026-11-01T00:00:00.000Z'),
              lt: new Date('2026-12-01T00:00:00.000Z'),
            },
          },
        ],
      });
      expect(where({ from: '2026-11-05', to: '2026-11-05' })).toEqual({
        AND: [
          {
            createdAt: {
              gte: new Date('2026-11-05T00:00:00.000Z'),
              lt: new Date('2026-11-06T00:00:00.000Z'),
            },
          },
        ],
      });
      expect(where({ to: '2026-12-31' })).toEqual({
        AND: [{ createdAt: { lt: new Date('2027-01-01T00:00:00.000Z') } }],
      });
    });

    it('400s when from is after to', () => {
      expect(() => where({ from: '2026-11-02', to: '2026-11-01' })).toThrow(
        new BadRequestException('from must not be after to'),
      );
    });
  });

  describe('service', () => {
    let prisma: any;
    let transitions: { apply: jest.Mock };
    let service: OrdersAdminService;

    beforeEach(() => {
      prisma = {
        order: {
          findMany: jest.fn().mockResolvedValue([orderFixture()]),
          count: jest.fn().mockResolvedValue(1),
          findUnique: jest.fn().mockResolvedValue(orderFixture()),
        },
        $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      };
      transitions = { apply: jest.fn().mockResolvedValue({}) };
      service = new OrdersAdminService(prisma, transitions as any);
    });

    it('lists newest first with the composed filter', async () => {
      const page = await service.list({ page: 1, limit: 20, customerId: 'c1' });
      const args = prisma.order.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ AND: [{ customerId: 'c1' }] });
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { seq: 'desc' }]);
      expect(page.items[0].customer).toEqual({
        id: 'customer-1',
        fullName: 'Asha',
        phone: '+255712345678',
        email: null,
      });
    });

    it('404s for an unknown order', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.get('x')).rejects.toThrow(new NotFoundException('Order not found'));
    });

    it('cancels as ADMIN scoped to the order, recording the admin', async () => {
      await service.cancelSubOrder('admin-1', 'order-1', 'sub-0', 'Fraud');
      expect(transitions.apply).toHaveBeenCalledWith({
        subOrderId: 'sub-0',
        where: { orderId: 'order-1' },
        actorType: 'ADMIN',
        actorId: 'admin-1',
        action: 'cancel',
        reason: 'Fraud',
      });
    });
  });
});
