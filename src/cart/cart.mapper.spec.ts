import { ListingStatus, ListingUnit, VendorStatus } from '@prisma/client';
import { CartItemWithListing, toCart } from './cart.mapper';

let seq = 0;
function item(
  opts: {
    vendor?: string;
    price?: number;
    lastSeen?: number;
    quantity?: number;
    stock?: number;
    status?: ListingStatus;
    shopStatus?: VendorStatus;
    ownerActive?: boolean;
  } = {},
): CartItemWithListing {
  seq += 1;
  const vendor = opts.vendor ?? 'a';
  const price = opts.price ?? 100;
  return {
    id: `item-${seq}`,
    cartId: 'cart',
    listingId: `listing-${seq}`,
    quantity: opts.quantity ?? 2,
    lastSeenPrice: opts.lastSeen ?? price,
    createdAt: new Date(),
    updatedAt: new Date(),
    listing: {
      id: `listing-${seq}`,
      title: `Listing ${seq}`,
      unit: ListingUnit.HEAD,
      unitPrice: price,
      stockQuantity: opts.stock ?? 10,
      status: opts.status ?? ListingStatus.ACTIVE,
      vendor: {
        id: `vendor-${vendor}`,
        slug: `shop-${vendor}`,
        shopName: `Shop ${vendor.toUpperCase()}`,
        status: opts.shopStatus ?? VendorStatus.APPROVED,
        user: { isActive: opts.ownerActive ?? true },
      },
    },
  };
}

describe('toCart', () => {
  it('returns an empty cart', () => {
    expect(toCart([])).toEqual({ shops: [], total: 0, lineCount: 0, exceedsMaxTotal: false });
  });

  it('groups by shop in first-seen order with subtotals and a total', () => {
    const cart = toCart([
      item({ vendor: 'a', price: 100, quantity: 2 }),
      item({ vendor: 'b', price: 50, quantity: 3 }),
      item({ vendor: 'a', price: 10, quantity: 1 }),
    ]);
    expect(cart.shops.map((s) => [s.shop.slug, s.lines.length, s.subtotal])).toEqual([
      ['shop-a', 2, 210],
      ['shop-b', 1, 150],
    ]);
    expect(cart.total).toBe(360);
    expect(cart.lineCount).toBe(3);
    expect(cart.shops[0].lines[0]).toMatchObject({
      unitPrice: 100,
      lineTotal: 200,
      stockLeft: 10,
      previousPrice: null,
      flags: [],
    });
  });

  it.each([
    ['listing paused', { status: ListingStatus.INACTIVE }],
    ['listing archived', { status: ListingStatus.ARCHIVED }],
    ['listing taken down', { status: ListingStatus.TAKEN_DOWN }],
    ['shop suspended', { shopStatus: VendorStatus.SUSPENDED }],
    ['owner deactivated', { ownerActive: false }],
  ])('flags UNAVAILABLE (%s), hides price and stock, excludes from totals', (_, opts) => {
    const cart = toCart([
      item({ price: 100, quantity: 1 }),
      item({ ...opts, price: 999, lastSeen: 1, stock: 0 }),
    ]);
    expect(cart.shops[0].lines[1]).toEqual({
      listingId: expect.any(String),
      title: expect.any(String),
      unit: 'HEAD',
      quantity: 2,
      unitPrice: null,
      lineTotal: null,
      stockLeft: null,
      previousPrice: null,
      flags: ['UNAVAILABLE'],
    });
    expect(cart.shops[0].subtotal).toBe(100);
    expect(cart.total).toBe(100);
    expect(cart.lineCount).toBe(2);
  });

  it('flags SHORT_OF_STOCK with the quantity left, and PRICE_CHANGED with both prices', () => {
    const [short, repriced, both] = toCart([
      item({ quantity: 5, stock: 3 }),
      item({ price: 130, lastSeen: 120 }),
      item({ quantity: 5, stock: 3, price: 130, lastSeen: 120 }),
    ]).shops[0].lines;
    expect(short).toMatchObject({ flags: ['SHORT_OF_STOCK'], stockLeft: 3, lineTotal: 500 });
    expect(repriced).toMatchObject({
      flags: ['PRICE_CHANGED'],
      unitPrice: 130,
      previousPrice: 120,
    });
    expect(both.flags).toEqual(['SHORT_OF_STOCK', 'PRICE_CHANGED']);
  });

  it('sums exactly in bigint and compares the maximum on the bigint', () => {
    const atMax = toCart([item({ price: 1_000_000_000, quantity: 10 })]);
    expect(atMax.total).toBe(10_000_000_000);
    expect(atMax.exceedsMaxTotal).toBe(false);

    const above = toCart([
      item({ price: 1_000_000_000, quantity: 10 }),
      item({ price: 1, quantity: 1 }),
    ]);
    expect(above.exceedsMaxTotal).toBe(true);

    // 50 lines of 1e15 (price 1e9 × quantity 1e6): 5e16 is above 2^53 but the flag is exact.
    const huge = toCart(
      Array.from({ length: 50 }, () =>
        item({ price: 1_000_000_000, quantity: 1_000_000, stock: 1_000_000 }),
      ),
    );
    expect(huge.shops[0].lines[0].lineTotal).toBe(1e15);
    expect(huge.exceedsMaxTotal).toBe(true);
    expect(huge.lineCount).toBe(50);
  });

  it('exposes exactly the contract keys', () => {
    const cart = toCart([item()]);
    expect(Object.keys(cart).sort()).toEqual(['exceedsMaxTotal', 'lineCount', 'shops', 'total']);
    expect(Object.keys(cart.shops[0]).sort()).toEqual(['lines', 'shop', 'subtotal']);
    expect(Object.keys(cart.shops[0].shop).sort()).toEqual(['shopName', 'slug']);
    expect(Object.keys(cart.shops[0].lines[0]).sort()).toEqual([
      'flags',
      'lineTotal',
      'listingId',
      'previousPrice',
      'quantity',
      'stockLeft',
      'title',
      'unit',
      'unitPrice',
    ]);
  });
});
