import { ConflictException, NotFoundException } from '@nestjs/common';
import { EXPIRY_BATCH, OrderExpiryService } from './order-expiry.service';
import { EXPIRY_REASON } from './order-status';

const NOW = new Date('2026-11-26T12:00:00Z');
const ids = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${String(from + i).padStart(4, '0')}` }));

describe('OrderExpiryService', () => {
  let prisma: any;
  let transitions: { apply: jest.Mock };
  let interval: number;
  let service: OrderExpiryService;

  beforeEach(() => {
    jest.useRealTimers();
    interval = 0;
    prisma = { subOrder: { findMany: jest.fn().mockResolvedValue([]) } };
    transitions = { apply: jest.fn().mockResolvedValue({}) };
    const config = { get: jest.fn(() => interval) };
    service = new OrderExpiryService(prisma, transitions as any, config as any);
  });

  it('expires PENDING sub-orders created at least 48 hours ago as the marketplace', async () => {
    prisma.subOrder.findMany.mockResolvedValueOnce(ids(1, 2));
    const result = await service.run(NOW);
    expect(result).toEqual({ expired: 2, failed: 0 });
    const args = prisma.subOrder.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      status: 'PENDING',
      createdAt: { lte: new Date('2026-11-24T12:00:00Z') },
    });
    expect(args.orderBy).toEqual({ id: 'asc' });
    expect(args.take).toBe(EXPIRY_BATCH);
    expect(transitions.apply).toHaveBeenCalledWith({
      subOrderId: 's0001',
      actorType: 'MARKETPLACE',
      actorId: null,
      action: 'expire',
      reason: EXPIRY_REASON,
    });
    expect(EXPIRY_REASON).toBe('The shop did not respond in time');
  });

  it('pages by id cursor past conflicts and failures', async () => {
    prisma.subOrder.findMany
      .mockResolvedValueOnce(ids(1, EXPIRY_BATCH))
      .mockResolvedValueOnce(ids(EXPIRY_BATCH + 1, 3));
    transitions.apply
      .mockRejectedValueOnce(new ConflictException('Cannot expire an order that is CONFIRMED'))
      .mockRejectedValueOnce(new NotFoundException())
      .mockRejectedValueOnce(new Error('connection lost'));
    const logger = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    const result = await service.run(NOW);
    expect(result).toEqual({ expired: EXPIRY_BATCH + 3 - 3, failed: 1 });
    expect(transitions.apply).toHaveBeenCalledTimes(EXPIRY_BATCH + 3);
    expect(prisma.subOrder.findMany.mock.calls[1][0].where.id).toEqual({
      gt: `s${String(EXPIRY_BATCH).padStart(4, '0')}`,
    });
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it('shares a run in progress instead of overlapping', async () => {
    let release!: (v: unknown) => void;
    prisma.subOrder.findMany.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    const a = service.run(NOW);
    const b = service.run(NOW);
    expect(b).toBe(a);
    release(ids(1, 1));
    await a;
    expect(prisma.subOrder.findMany).toHaveBeenCalledTimes(1);
    expect(transitions.apply).toHaveBeenCalledTimes(1);
    // A later call starts a new run.
    await service.run(NOW);
    expect(prisma.subOrder.findMany).toHaveBeenCalledTimes(2);
  });

  it('never runs when the interval is 0', () => {
    jest.useFakeTimers();
    const run = jest.spyOn(service, 'run');
    service.onApplicationBootstrap();
    jest.advanceTimersByTime(3_600_000);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs at bootstrap and on every interval, and stops on shutdown', async () => {
    jest.useFakeTimers();
    interval = 300_000;
    const run = jest.spyOn(service, 'run').mockResolvedValue({ expired: 0, failed: 0 });
    service.onApplicationBootstrap();
    expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(300_000);
    expect(run).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(300_000);
    expect(run).toHaveBeenCalledTimes(3);
    await service.onModuleDestroy();
    jest.advanceTimersByTime(900_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('logs and survives a failing query', async () => {
    prisma.subOrder.findMany.mockRejectedValue(new Error('db down'));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.run(NOW)).resolves.toEqual({ expired: 0, failed: 0 });
  });
});
