import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrderActorType, SubOrderStatus } from '@prisma/client';
import { ORDER_TX_OPTIONS, TransitionAction } from './order-status';
import { SubOrderTransitionsService, TransitionRequest } from './sub-order-transitions.service';

const S = SubOrderStatus;
const ITEMS = [
  { listingId: 'l1', quantity: 2 },
  { listingId: 'l2', quantity: 1 },
];

describe('SubOrderTransitionsService', () => {
  let tx: any;
  let prisma: any;
  let stock: { giveBack: jest.Mock };
  let service: SubOrderTransitionsService;
  let status: SubOrderStatus;
  let found: boolean;

  beforeEach(() => {
    status = S.PENDING;
    found = true;
    tx = {
      subOrder: {
        findFirst: jest.fn(() => Promise.resolve(found ? { id: 's1' } : null)),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn(() => Promise.resolve([{ status }])),
      subOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      orderItem: { findMany: jest.fn().mockResolvedValue(ITEMS) },
    };
    prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
    stock = { giveBack: jest.fn().mockResolvedValue(undefined) };
    service = new SubOrderTransitionsService(prisma, stock as any);
  });

  const req = (overrides: Partial<TransitionRequest> = {}): TransitionRequest => ({
    subOrderId: 's1',
    where: { vendorId: 'v1' },
    actorType: OrderActorType.VENDOR,
    actorId: 'u1',
    action: 'confirm',
    ...overrides,
  });

  it('runs in one transaction with the order time limits and scopes the lookup', async () => {
    await service.apply(req());
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), ORDER_TX_OPTIONS);
    expect(tx.subOrder.findFirst).toHaveBeenCalledWith({
      where: { vendorId: 'v1', id: 's1' },
      select: { id: true },
    });
    const [strings] = tx.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain('FOR UPDATE');
  });

  type Case = [
    OrderActorType,
    TransitionAction,
    SubOrderStatus,
    SubOrderStatus,
    boolean,
    string | undefined,
  ];
  it.each<Case>([
    ['VENDOR', 'confirm', S.PENDING, S.CONFIRMED, false, undefined],
    ['VENDOR', 'dispatch', S.CONFIRMED, S.DISPATCHED, false, undefined],
    ['VENDOR', 'deliver', S.DISPATCHED, S.DELIVERED, false, undefined],
    ['VENDOR', 'reject', S.PENDING, S.REJECTED, true, 'No stock'],
    ['VENDOR', 'cancel', S.CONFIRMED, S.CANCELLED, true, 'Sick animal'],
    ['CUSTOMER', 'cancel', S.PENDING, S.CANCELLED, true, undefined],
    ['ADMIN', 'cancel', S.PENDING, S.CANCELLED, true, 'Fraud'],
    ['ADMIN', 'cancel', S.CONFIRMED, S.CANCELLED, true, 'Fraud'],
    ['ADMIN', 'cancel', S.DISPATCHED, S.CANCELLED, false, 'Lost'],
    ['MARKETPLACE', 'expire', S.PENDING, S.CANCELLED, true, 'Late'],
  ])('%s %s from %s → %s (stock returned: %s)', async (actor, action, from, to, back, reason) => {
    status = from;
    const actorId = actor === 'MARKETPLACE' ? null : 'u1';
    const result = await service.apply(req({ actorType: actor, actorId, action, reason }));

    expect(result).toEqual({ from, to, stockReturned: back });
    const data = tx.subOrder.update.mock.calls[0][0].data;
    expect(data.status).toBe(to);
    expect(data.cashCollectedAt instanceof Date).toBe(to === S.DELIVERED);
    expect(tx.subOrderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        subOrderId: 's1',
        fromStatus: from,
        toStatus: to,
        actorType: actor,
        actorId,
        reason: reason ?? null,
      },
    });
    if (back) expect(stock.giveBack).toHaveBeenCalledWith(tx, ITEMS);
    else expect(stock.giveBack).not.toHaveBeenCalled();
  });

  it('404s and changes nothing outside the scope', async () => {
    found = false;
    await expect(service.apply(req())).rejects.toThrow(new NotFoundException('Order not found'));
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.subOrder.update).not.toHaveBeenCalled();
    expect(tx.subOrderStatusHistory.create).not.toHaveBeenCalled();
  });

  it('409s naming the current status and changes nothing', async () => {
    status = S.PENDING;
    await expect(service.apply(req({ action: 'deliver' }))).rejects.toThrow(
      new ConflictException('Cannot deliver an order that is PENDING'),
    );
    expect(tx.subOrder.update).not.toHaveBeenCalled();
    expect(tx.subOrderStatusHistory.create).not.toHaveBeenCalled();
    expect(stock.giveBack).not.toHaveBeenCalled();
  });

  it('stores a blank optional reason as null and drops reasons on reason-less actions', async () => {
    await service.apply(
      req({ actorType: 'CUSTOMER', action: 'cancel', where: undefined, reason: '   ' }),
    );
    expect(tx.subOrderStatusHistory.create.mock.calls[0][0].data.reason).toBeNull();
    status = S.PENDING;
    await service.apply(req({ reason: 'ignored' }));
    expect(tx.subOrderStatusHistory.create.mock.calls[1][0].data.reason).toBeNull();
  });

  it('rejects programming errors before touching the database', () => {
    expect(() => service.apply(req({ action: 'expire' }))).toThrow();
    expect(() => service.apply(req({ action: 'reject' }))).toThrow();
    expect(() => service.apply(req({ actorType: 'MARKETPLACE', action: 'expire' }))).toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
