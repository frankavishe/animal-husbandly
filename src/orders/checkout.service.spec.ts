import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ListingType, ListingUnit, Species, SubOrderStatus } from '@prisma/client';
import { CartLine } from '../cart/cart.service';
import { LockedListing } from '../listings/listing-stock.service';
import {
  ABOVE_MAX_TOTAL,
  CheckoutService,
  EMPTY_CART,
  findProblems,
  groupByShop,
  KEY_REUSED,
  submissionHash,
  TOO_MANY_OPEN,
} from './checkout.service';
import { CheckoutDto } from './dto';
import { orderFixture } from './order.fixtures-spec';
import { ORDER_TX_OPTIONS } from './order-status';

const USER = 'buyer';
const ADDRESS = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';

function listing(id: string, overrides: Partial<LockedListing> = {}): LockedListing {
  return {
    id,
    title: `Title ${id}`,
    species: Species.CATTLE,
    listingType: ListingType.LIVE_ANIMAL,
    unit: ListingUnit.HEAD,
    unitPrice: 1000,
    stockQuantity: 10,
    available: true,
    vendor: { id: 'v1', userId: 'seller-1', shopName: 'Shop One', slug: 'shop-one' },
    ...overrides,
  };
}
const cartLine = (id: string, quantity = 2, price = 1000): CartLine => ({
  listingId: id,
  quantity,
  lastSeenPrice: price,
  title: `Title ${id}`,
});
const confirmed = (id: string, quantity = 2, unitPrice = 1000) => ({
  listingId: id,
  quantity,
  unitPrice,
});

describe('submissionHash', () => {
  it('does not depend on line order but on every value', () => {
    const a = submissionHash({ addressId: ADDRESS, lines: [confirmed('a'), confirmed('b')] });
    expect(submissionHash({ addressId: ADDRESS, lines: [confirmed('b'), confirmed('a')] })).toBe(a);
    expect(submissionHash({ addressId: KEY, lines: [confirmed('a'), confirmed('b')] })).not.toBe(a);
    expect(
      submissionHash({ addressId: ADDRESS, lines: [confirmed('a', 3), confirmed('b')] }),
    ).not.toBe(a);
    expect(
      submissionHash({ addressId: ADDRESS, lines: [confirmed('a', 2, 999), confirmed('b')] }),
    ).not.toBe(a);
    expect(submissionHash({ addressId: ADDRESS, lines: [confirmed('a')] })).not.toBe(a);
  });
});

describe('findProblems', () => {
  it('is empty when everything matches', () => {
    expect(findProblems(USER, [cartLine('a')], [confirmed('a')], [listing('a')])).toEqual([]);
  });

  it('reports every problem type, all together, in the contract wording', () => {
    const cart = [
      cartLine('a'),
      cartLine('b'),
      cartLine('c', 3),
      cartLine('d'),
      cartLine('e'),
      cartLine('f', 3),
    ];
    const lines = [
      confirmed('b'),
      confirmed('c', 3),
      confirmed('d', 1),
      confirmed('e', 2, 1200),
      confirmed('f', 3),
      confirmed('x'),
    ];
    const locked = [
      listing('a'),
      listing('b', { available: false }),
      listing('c', { vendor: { id: 'mine', userId: USER, shopName: 'Mine', slug: 'mine' } }),
      listing('d'),
      listing('e', { unitPrice: 1300 }),
      listing('f', { stockQuantity: 2 }),
    ];
    expect(findProblems(USER, cart, lines, locked)).toEqual([
      '"Title a" (a) is in your cart but was not confirmed',
      '"Title b" (b) is no longer available',
      '"Title c" (c): you cannot buy from your own shop',
      '"Title d" (d): quantity in your cart is 2 (you confirmed 1)',
      '"Title e" (e): price is now 1300 (you confirmed 1200)',
      '"Title f" (f): only 2 left (you asked for 3)',
      'Listing x is not in your cart',
    ]);
  });

  it('reports a price change even when another change keeps the total the same', () => {
    // a: 2 × 1000 → confirmed 2 × 1100; b: 2 × 1000 → confirmed 2 × 900. Same total.
    const problems = findProblems(
      USER,
      [cartLine('a'), cartLine('b')],
      [confirmed('a', 2, 1100), confirmed('b', 2, 900)],
      [listing('a'), listing('b')],
    );
    expect(problems).toEqual([
      '"Title a" (a): price is now 1000 (you confirmed 1100)',
      '"Title b" (b): price is now 1000 (you confirmed 900)',
    ]);
  });

  it('treats a listing missing from the lock as unavailable', () => {
    expect(findProblems(USER, [cartLine('a')], [confirmed('a')], [])).toEqual([
      '"Title a" (a) is no longer available',
    ]);
  });
});

describe('groupByShop', () => {
  it('splits per shop with exact subtotals and a total', () => {
    const v2 = { id: 'v2', userId: 's2', shopName: 'Shop Two', slug: 'shop-two' };
    const { groups, total } = groupByShop(
      [confirmed('a', 2, 1000), confirmed('b', 1, 500), confirmed('c', 3, 1_000_000_000)],
      [listing('a'), listing('b', { vendor: v2 }), listing('c')],
    );
    expect(groups.map((g) => [g.vendorId, g.shopName, g.subtotal, g.items.length])).toEqual([
      ['v1', 'Shop One', 3_000_002_000n, 2],
      ['v2', 'Shop Two', 500n, 1],
    ]);
    expect(total).toBe(3_000_002_500n);
    expect(groups[0].items[1]).toMatchObject({
      title: 'Title c',
      unitPrice: 1_000_000_000,
      quantity: 3,
      lineTotal: 3_000_000_000n,
    });
  });
});

describe('CheckoutService', () => {
  let tx: any;
  let prisma: any;
  let cart: any;
  let stock: any;
  let addresses: any;
  let service: CheckoutService;
  let dto: CheckoutDto;

  beforeEach(() => {
    dto = {
      addressId: ADDRESS,
      submissionKey: KEY,
      lines: [confirmed('a'), confirmed('b', 1, 500)],
    };
    tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'new-order' }),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(orderFixture()) },
    };
    cart = {
      lockForCheckout: jest.fn().mockResolvedValue('cart-1'),
      loadLines: jest.fn().mockResolvedValue([cartLine('a'), cartLine('b', 1, 500)]),
      empty: jest.fn().mockResolvedValue(undefined),
    };
    stock = {
      lockForSale: jest.fn().mockResolvedValue([
        listing('a'),
        listing('b', {
          unitPrice: 500,
          vendor: { id: 'v2', userId: 's2', shopName: 'Two', slug: 'two' },
        }),
      ]),
      take: jest.fn().mockResolvedValue(undefined),
    };
    addresses = {
      get: jest.fn().mockResolvedValue({
        recipientName: 'Asha',
        contactPhone: '+255712345678',
        region: { id: 1, name: 'Arusha' },
        district: { id: 2, name: 'Meru' },
        wardStreet: 'Sakina',
        landmark: null,
      }),
    };
    service = new CheckoutService(prisma, cart, stock, addresses);
  });

  const nothingChanged = () => {
    expect(stock.take).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(cart.empty).not.toHaveBeenCalled();
  };

  it('places the order: lock first, stock taken, copies made, cart emptied', async () => {
    const result = await service.checkout(USER, dto);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), ORDER_TX_OPTIONS);
    expect(cart.lockForCheckout).toHaveBeenCalledWith(tx, USER);
    expect(cart.lockForCheckout.mock.invocationCallOrder[0]).toBeLessThan(
      tx.order.findUnique.mock.invocationCallOrder[0],
    );
    expect(stock.lockForSale).toHaveBeenCalledWith(tx, ['a', 'b']);
    expect(stock.take.mock.calls).toEqual([
      [tx, 'a', 2],
      [tx, 'b', 1],
    ]);
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      customerId: USER,
      recipientName: 'Asha',
      regionName: 'Arusha',
      districtName: 'Meru',
      total: 2500n,
      submissionKey: KEY,
      submissionHash: submissionHash(dto),
    });
    const subs = data.subOrders.create;
    expect(subs.map((s: any) => [s.vendor.connect.id, s.shopName, s.subtotal])).toEqual([
      ['v1', 'Shop One', 2000n],
      ['v2', 'Two', 500n],
    ]);
    expect(subs[0].createdAt).toBe(data.createdAt);
    expect(subs[0].history.create[0]).toMatchObject({
      fromStatus: null,
      toStatus: SubOrderStatus.PENDING,
      actorType: 'CUSTOMER',
      actor: { connect: { id: USER } },
    });
    expect(cart.empty).toHaveBeenCalledWith(tx, 'cart-1');
    expect(result.orderNumber).toBe('ORD-00000042');
  });

  it('replays a matching submission before any other check', async () => {
    tx.order.findUnique.mockResolvedValue({ id: 'old', submissionHash: submissionHash(dto) });
    tx.order.count.mockResolvedValue(10);
    cart.loadLines.mockResolvedValue([]);
    addresses.get.mockRejectedValue(new NotFoundException('Address not found'));
    await service.checkout(USER, dto);
    expect(prisma.order.findUniqueOrThrow.mock.calls[0][0].where).toEqual({ id: 'old' });
    expect(tx.order.findUnique.mock.calls[0][0].where).toEqual({
      customerId_submissionKey: { customerId: USER, submissionKey: KEY },
    });
    nothingChanged();
  });

  it('409s when the key was used with different data', async () => {
    tx.order.findUnique.mockResolvedValue({ id: 'old', submissionHash: 'other' });
    await expect(service.checkout(USER, dto)).rejects.toThrow(new ConflictException(KEY_REUSED));
    nothingChanged();
  });

  it('409s at 10 open orders, counting only OPEN ones', async () => {
    tx.order.count.mockResolvedValue(10);
    await expect(service.checkout(USER, dto)).rejects.toThrow(new ConflictException(TOO_MANY_OPEN));
    expect(tx.order.count.mock.calls[0][0].where).toEqual({
      customerId: USER,
      subOrders: { some: { status: { in: ['PENDING', 'CONFIRMED', 'DISPATCHED'] } } },
    });
    nothingChanged();
  });

  it('400s for an empty cart', async () => {
    cart.loadLines.mockResolvedValue([]);
    await expect(service.checkout(USER, dto)).rejects.toThrow(new BadRequestException(EMPTY_CART));
    nothingChanged();
  });

  it("404s for someone else's or a missing address", async () => {
    addresses.get.mockRejectedValue(new NotFoundException('Address not found'));
    await expect(service.checkout(USER, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(addresses.get).toHaveBeenCalledWith(USER, ADDRESS, tx);
    nothingChanged();
  });

  it('409s with every problem as message[]', async () => {
    stock.lockForSale.mockResolvedValue([
      listing('a', { stockQuantity: 1 }),
      listing('b', { available: false }),
    ]);
    const err = await service.checkout(USER, dto).catch((e: ConflictException) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      message: [
        '"Title a" (a): only 1 left (you asked for 2)',
        '"Title b" (b) is no longer available',
      ],
    });
    nothingChanged();
  });

  it('accepts a total exactly at the maximum and refuses one above it', async () => {
    const max = { listingId: 'a', quantity: 10, unitPrice: 1_000_000_000 };
    cart.loadLines.mockResolvedValue([cartLine('a', 10, 1_000_000_000)]);
    stock.lockForSale.mockResolvedValue([listing('a', { unitPrice: 1_000_000_000 })]);
    await service.checkout(USER, { ...dto, lines: [max] });
    expect(tx.order.create.mock.calls[0][0].data.total).toBe(10_000_000_000n);

    cart.loadLines.mockResolvedValue([cartLine('a', 10, 1_000_000_000), cartLine('b', 1, 1)]);
    stock.lockForSale.mockResolvedValue([
      listing('a', { unitPrice: 1_000_000_000 }),
      listing('b', { unitPrice: 1 }),
    ]);
    stock.take.mockClear();
    tx.order.create.mockClear();
    cart.empty.mockClear();
    await expect(
      service.checkout(USER, {
        ...dto,
        lines: [max, { listingId: 'b', quantity: 1, unitPrice: 1 }],
      }),
    ).rejects.toThrow(new ConflictException(ABOVE_MAX_TOTAL));
    nothingChanged();
  });
});
