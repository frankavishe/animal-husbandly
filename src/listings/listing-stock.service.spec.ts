import { ConflictException } from '@nestjs/common';
import { ListingStatus, VendorStatus } from '@prisma/client';
import { ListingStockService, MAX_STOCK } from './listing-stock.service';

/** Flattens a tagged-template call into its SQL text and bound values. */
function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
}

const vendor = { id: 'v1', userId: 'u1', shopName: 'Shop', slug: 'shop' };
const row = (id: string) => ({
  id,
  title: `Listing ${id}`,
  species: 'CATTLE',
  listingType: 'LIVE_ANIMAL',
  unit: 'HEAD',
  unitPrice: 100,
  stockQuantity: 5,
  vendor,
});

describe('ListingStockService', () => {
  let tx: any;
  const service = new ListingStockService();

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      listing: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
  });

  describe('lockForSale', () => {
    it('does nothing for no ids', async () => {
      expect(await service.lockForSale(tx, [])).toEqual([]);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('locks distinct ids in id order with bound parameters, then flags visibility', async () => {
      tx.listing.findMany
        .mockResolvedValueOnce([row('c'), row('a'), row('b')])
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'c' }]);
      const result = await service.lockForSale(tx, ['c', 'a', 'b', 'a']);

      const { text, values } = sqlOf(tx.$queryRaw.mock.calls[0]);
      expect(text).toBe(
        'SELECT id FROM listings WHERE id = ANY(?::uuid[]) ORDER BY id FOR NO KEY UPDATE',
      );
      expect(values).toEqual([['a', 'b', 'c']]);

      const visibleWhere = tx.listing.findMany.mock.calls[1][0].where;
      expect(visibleWhere).toEqual({
        id: { in: ['a', 'b', 'c'] },
        status: ListingStatus.ACTIVE,
        vendor: { status: VendorStatus.APPROVED, user: { isActive: true } },
      });
      expect(result.map((l) => [l.id, l.available])).toEqual([
        ['a', true],
        ['b', false],
        ['c', true],
      ]);
      expect(result[0]).toMatchObject({ unitPrice: 100, stockQuantity: 5, vendor });
    });
  });

  describe('take', () => {
    it('decrements only when enough stock is left', async () => {
      tx.listing.updateMany.mockResolvedValue({ count: 1 });
      await service.take(tx, 'a', 3);
      expect(tx.listing.updateMany).toHaveBeenCalledWith({
        where: { id: 'a', stockQuantity: { gte: 3 } },
        data: { stockQuantity: { decrement: 3 } },
      });
    });

    it('throws 409 when no row was updated', async () => {
      tx.listing.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.take(tx, 'a', 3)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('giveBack', () => {
    it('adds back per listing in id order, capped, without touching status', async () => {
      await service.giveBack(tx, [
        { listingId: 'c', quantity: 1 },
        { listingId: 'a', quantity: 2 },
        { listingId: 'c', quantity: 4 },
      ]);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
      const calls = tx.$executeRaw.mock.calls.map(sqlOf);
      for (const { text } of calls) {
        expect(text).toBe(
          'UPDATE listings SET stock_quantity = LEAST(stock_quantity + ?, ?), updated_at = now() WHERE id = ?::uuid',
        );
        expect(text).not.toContain('status');
      }
      expect(calls.map((c: { values: unknown[] }) => c.values)).toEqual([
        [2, MAX_STOCK, 'a'],
        [5, MAX_STOCK, 'c'],
      ]);
    });

    it('does nothing for no items', async () => {
      await service.giveBack(tx, []);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });
});
