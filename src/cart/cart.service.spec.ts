import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ListingStatus, VendorStatus } from '@prisma/client';
import { ORDER_TX_OPTIONS } from '../orders/order-status';
import { CartService, MAX_CART_LINES } from './cart.service';

const USER = 'user-1';
const CART = 'cart-1';
const L = 'listing-1';

describe('CartService', () => {
  let tx: any;
  let prisma: any;
  let service: CartService;
  let listing: {
    title: string;
    unitPrice: number;
    stockQuantity: number;
    vendor: { userId: string };
  } | null;
  let existing: { id: string; quantity: number } | null;
  let lineCount: number;

  beforeEach(() => {
    listing = {
      title: 'Boran heifer',
      unitPrice: 1000,
      stockQuantity: 10,
      vendor: { userId: 'seller' },
    };
    existing = null;
    lineCount = 0;
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ id: CART }]),
      listing: { findFirst: jest.fn(() => Promise.resolve(listing)) },
      cartItem: {
        findUnique: jest.fn(() => Promise.resolve(existing)),
        count: jest.fn(() => Promise.resolve(lineCount)),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      cart: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      cart: { findUnique: jest.fn().mockResolvedValue({ id: CART }) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new CartService(prisma);
  });

  describe('get', () => {
    it('returns an empty cart when the user never used one', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);
      expect(await service.get(USER)).toEqual({
        shops: [],
        total: 0,
        lineCount: 0,
        exceedsMaxTotal: false,
      });
      expect(prisma.cartItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('writes', () => {
    it('create the cart if needed and lock it FOR UPDATE with bound parameters, in one transaction', async () => {
      await service.add(USER, { listingId: L, quantity: 1 });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), ORDER_TX_OPTIONS);
      const insert = tx.$executeRaw.mock.calls[0];
      expect(insert[0].join('?')).toContain('ON CONFLICT (user_id) DO NOTHING');
      expect(insert.slice(1)).toEqual([USER]);
      const lock = tx.$queryRaw.mock.calls[0];
      expect(lock[0].join('?')).toContain('FOR UPDATE');
      expect(lock.slice(1)).toEqual([USER]);
    });
  });

  describe('add', () => {
    it('only considers publicly visible listings', async () => {
      await service.add(USER, { listingId: L, quantity: 1 });
      expect(tx.listing.findFirst.mock.calls[0][0].where).toEqual({
        id: L,
        status: ListingStatus.ACTIVE,
        vendor: { status: VendorStatus.APPROVED, user: { isActive: true } },
      });
    });

    it('creates a line at the current price', async () => {
      await service.add(USER, { listingId: L, quantity: 3 });
      expect(tx.cartItem.upsert).toHaveBeenCalledWith({
        where: { cartId_listingId: { cartId: CART, listingId: L } },
        create: { cartId: CART, listingId: L, quantity: 3, lastSeenPrice: 1000 },
        update: { quantity: 3, lastSeenPrice: 1000 },
      });
    });

    it('adds to an existing line and refreshes the seen price', async () => {
      existing = { id: 'i', quantity: 3 };
      listing!.unitPrice = 1200;
      await service.add(USER, { listingId: L, quantity: 2 });
      expect(tx.cartItem.upsert.mock.calls[0][0].update).toEqual({
        quantity: 5,
        lastSeenPrice: 1200,
      });
      expect(tx.cartItem.count).not.toHaveBeenCalled();
    });

    it('404s for a listing that is not visible', async () => {
      listing = null;
      await expect(service.add(USER, { listingId: L, quantity: 1 })).rejects.toThrow(
        new NotFoundException('Listing not found'),
      );
    });

    it('403s for the own shop', async () => {
      listing!.vendor.userId = USER;
      await expect(service.add(USER, { listingId: L, quantity: 1 })).rejects.toThrow(
        new ForbiddenException('You cannot buy from your own shop'),
      );
    });

    it('409s when out of stock', async () => {
      listing!.stockQuantity = 0;
      await expect(service.add(USER, { listingId: L, quantity: 1 })).rejects.toThrow(
        new ConflictException('"Boran heifer" is out of stock'),
      );
    });

    it('409s naming the stock when the combined quantity is above it, line unchanged', async () => {
      existing = { id: 'i', quantity: 5 };
      await expect(service.add(USER, { listingId: L, quantity: 6 })).rejects.toThrow(
        new ConflictException(
          'Only 10 of "Boran heifer" in stock (you already have 5 in your cart)',
        ),
      );
      expect(tx.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('409s on a new line beyond 50', async () => {
      lineCount = MAX_CART_LINES;
      await expect(service.add(USER, { listingId: L, quantity: 1 })).rejects.toThrow(
        new ConflictException('Your cart can hold at most 50 different listings'),
      );
      expect(tx.cartItem.upsert).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    beforeEach(() => {
      existing = { id: 'item-1', quantity: 3 };
    });

    it('replaces the quantity and refreshes the seen price', async () => {
      await service.set(USER, L, { quantity: 4 });
      expect(tx.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { quantity: 4, lastSeenPrice: 1000 },
      });
    });

    it('404s when not in the cart', async () => {
      existing = null;
      await expect(service.set(USER, L, { quantity: 1 })).rejects.toThrow(
        new NotFoundException('Listing is not in your cart'),
      );
    });

    it('404s when no longer visible, 403s for the own shop', async () => {
      listing = null;
      await expect(service.set(USER, L, { quantity: 1 })).rejects.toBeInstanceOf(NotFoundException);
      listing = { title: 'x', unitPrice: 1, stockQuantity: 5, vendor: { userId: USER } };
      await expect(service.set(USER, L, { quantity: 1 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('409s above stock and when out of stock', async () => {
      await expect(service.set(USER, L, { quantity: 11 })).rejects.toThrow(
        new ConflictException('Only 10 of "Boran heifer" in stock'),
      );
      listing!.stockQuantity = 0;
      await expect(service.set(USER, L, { quantity: 1 })).rejects.toThrow(
        new ConflictException('"Boran heifer" is out of stock'),
      );
      expect(tx.cartItem.update).not.toHaveBeenCalled();
    });
  });

  describe('remove and clear', () => {
    it('remove works without checking visibility', async () => {
      await service.remove(USER, L);
      expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: CART, listingId: L },
      });
      expect(tx.listing.findFirst).not.toHaveBeenCalled();
    });

    it('remove 404s when not in the cart', async () => {
      tx.cartItem.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.remove(USER, L)).rejects.toThrow(
        new NotFoundException('Listing is not in your cart'),
      );
    });

    it('clear deletes every line', async () => {
      await service.clear(USER);
      expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: CART } });
    });
  });

  describe('checkout helpers', () => {
    it('loadLines returns lines in listing id order with titles', async () => {
      tx.cartItem.findMany.mockResolvedValue([
        { listingId: 'a', quantity: 1, lastSeenPrice: 5, listing: { title: 'A' } },
      ]);
      expect(await service.loadLines(tx, CART)).toEqual([
        { listingId: 'a', quantity: 1, lastSeenPrice: 5, title: 'A' },
      ]);
      expect(tx.cartItem.findMany.mock.calls[0][0].orderBy).toEqual({ listingId: 'asc' });
    });
  });
});
