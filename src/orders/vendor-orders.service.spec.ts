import { NotFoundException } from '@nestjs/common';
import { SubOrderStatus } from '@prisma/client';
import { orderFixture } from './order.fixtures-spec';
import { VendorOrdersService } from './vendor-orders.service';

const USER = 'vendor-user';
const VENDOR = 'vendor-0';

function vendorSub() {
  const { subOrders, customer: _customer, ...rest } = orderFixture();
  return { ...subOrders[0], order: rest };
}

describe('VendorOrdersService', () => {
  let prisma: any;
  let vendors: { findMine: jest.Mock };
  let transitions: { apply: jest.Mock };
  let service: VendorOrdersService;

  beforeEach(() => {
    prisma = {
      subOrder: {
        findMany: jest.fn().mockResolvedValue([vendorSub()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(vendorSub()),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    vendors = { findMine: jest.fn().mockResolvedValue({ id: VENDOR, status: 'SUSPENDED' }) };
    transitions = { apply: jest.fn().mockResolvedValue({}) };
    service = new VendorOrdersService(prisma, vendors as any, transitions as any);
  });

  it('lists only the own shop, newest first, paginated, filtered by status', async () => {
    const page = await service.list(USER, { page: 2, limit: 10, status: SubOrderStatus.PENDING });
    expect(vendors.findMine).toHaveBeenCalledWith(USER);
    const args = prisma.subOrder.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ vendorId: VENDOR, status: 'PENDING' });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(prisma.subOrder.count).toHaveBeenCalledWith({
      where: { vendorId: VENDOR, status: 'PENDING' },
    });
    expect(page).toMatchObject({ page: 2, limit: 10, total: 1, totalPages: 1 });
    expect(page.items[0].orderNumber).toBe('ORD-00000042');
  });

  it('lists every status without a filter', async () => {
    await service.list(USER, { page: 1, limit: 20 });
    expect(prisma.subOrder.findMany.mock.calls[0][0].where).toEqual({ vendorId: VENDOR });
  });

  it('gets only the own shop', async () => {
    await service.get(USER, 'sub-0');
    expect(prisma.subOrder.findFirst.mock.calls[0][0].where).toEqual({
      id: 'sub-0',
      vendorId: VENDOR,
    });
    prisma.subOrder.findFirst.mockResolvedValue(null);
    await expect(service.get(USER, 'x')).rejects.toThrow(new NotFoundException('Order not found'));
  });

  it('propagates "no shop" as 404', async () => {
    vendors.findMine.mockRejectedValue(new NotFoundException('You do not have a shop'));
    await expect(service.list(USER, { page: 1, limit: 20 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['confirm', undefined],
    ['dispatch', undefined],
    ['deliver', undefined],
    ['reject', 'No stock'],
    ['cancel', 'Animal sick'],
  ] as const)('%s applies the vendor transition scoped to the shop', async (action, reason) => {
    const result = await (service as any)[action](USER, 'sub-0', reason);
    expect(transitions.apply).toHaveBeenCalledWith({
      subOrderId: 'sub-0',
      where: { vendorId: VENDOR },
      actorType: 'VENDOR',
      actorId: USER,
      action,
      reason,
    });
    expect(result.id).toBe('sub-0');
  });
});
