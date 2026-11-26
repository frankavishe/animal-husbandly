import { randomUUID } from 'node:crypto';
import {
  addToCart,
  API,
  bearer,
  buyerWithAddress,
  cartLines,
  checkout,
  createApp,
  getStock,
  loginAdmin,
  registerUser,
  resetUsers,
  shopWithListing,
  TestContext,
} from './utils';

jest.setTimeout(180_000);

describe('Checkout under simultaneous requests (US2, SC-002)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('50 buyers for stock 10: exactly 10 orders, 40 conflicts, stock 0, no server errors', async () => {
    const s = await shopWithListing(ctx, admin.accessToken, { stockQuantity: 10, unitPrice: 5000 });
    const district = await ctx.prisma.district.findFirstOrThrow({ orderBy: { id: 'asc' } });

    // Register through the API (tokens are needed), then insert carts and addresses directly.
    const buyers = await Promise.all(Array.from({ length: 50 }, () => registerUser(ctx)));
    const addressIds: string[] = [];
    for (const b of buyers) {
      const address = await ctx.prisma.address.create({
        data: {
          userId: b.id,
          label: 'Home',
          recipientName: 'Buyer',
          contactPhone: '+255754000000',
          regionId: district.regionId,
          districtId: district.id,
          wardStreet: 'Street',
          isDefault: true,
        },
      });
      addressIds.push(address.id);
      await ctx.prisma.cart.create({
        data: {
          userId: b.id,
          items: { create: { listingId: s.listingId, quantity: 1, lastSeenPrice: 5000 } },
        },
      });
    }

    const lines = [{ listingId: s.listingId, quantity: 1, unitPrice: 5000 }];
    const results = await Promise.all(
      buyers.map((b, i) => checkout(ctx, b.accessToken, addressIds[i], { lines })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((x) => x === 201)).toHaveLength(10);
    expect(statuses.filter((x) => x === 409)).toHaveLength(40);
    expect(statuses.filter((x) => x >= 500)).toHaveLength(0);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.message).toEqual([
        `"Boran heifer" (${s.listingId}): only 0 left (you asked for 1)`,
      ]);
    }
    expect(await getStock(ctx, s.listingId)).toBe(0);
    const sold = await ctx.prisma.orderItem.aggregate({
      where: { listingId: s.listingId },
      _sum: { quantity: true },
    });
    expect(sold._sum.quantity).toBe(10);
  });

  it('the same key sent 5 times at once creates one order', async () => {
    const s = await shopWithListing(ctx, admin.accessToken);
    const buyer = await buyerWithAddress(ctx);
    await addToCart(ctx, buyer.token, s.listingId, 2);
    const lines = await cartLines(ctx, buyer.token);
    const submissionKey = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        checkout(ctx, buyer.token, buyer.addressId, { lines, submissionKey }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await ctx.prisma.order.count({ where: { customerId: buyer.id } })).toBe(1);
    expect(await getStock(ctx, s.listingId)).toBe(8);
  });

  it('two different keys at 9 OPEN orders: at most one succeeds', async () => {
    const s = await shopWithListing(ctx, admin.accessToken, { stockQuantity: 100 });
    const buyer = await buyerWithAddress(ctx);
    for (let i = 0; i < 9; i += 1) {
      await addToCart(ctx, buyer.token, s.listingId, 1);
      expect((await checkout(ctx, buyer.token, buyer.addressId)).status).toBe(201);
    }
    await addToCart(ctx, buyer.token, s.listingId, 1);
    const lines = await cartLines(ctx, buyer.token);
    const results = await Promise.all(
      [randomUUID(), randomUUID()].map((submissionKey) =>
        checkout(ctx, buyer.token, buyer.addressId, { lines, submissionKey }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.some((r) => r.status >= 500)).toBe(false);
    expect(await ctx.prisma.order.count({ where: { customerId: buyer.id } })).toBe(10);
  });

  it('carts holding the same listings in opposite order do not deadlock', async () => {
    const one = await shopWithListing(ctx, admin.accessToken, { stockQuantity: 100 });
    const two = await shopWithListing(ctx, admin.accessToken, { stockQuantity: 100 });
    const pairs = 5;
    const buyers = await Promise.all(
      Array.from({ length: pairs * 2 }, () => buyerWithAddress(ctx)),
    );
    for (const [i, b] of buyers.entries()) {
      const order = i % 2 === 0 ? [one, two] : [two, one];
      for (const s of order) await addToCart(ctx, b.token, s.listingId, 1);
    }
    const results = await Promise.all(buyers.map((b) => checkout(ctx, b.token, b.addressId)));
    expect(results.map((r) => r.status)).toEqual(Array(pairs * 2).fill(201));
    expect(await getStock(ctx, one.listingId)).toBe(100 - pairs * 2);
    expect(await getStock(ctx, two.listingId)).toBe(100 - pairs * 2);
  });

  it('a vendor edit without stock during checkouts keeps the reduction (FR-032)', async () => {
    const s = await shopWithListing(ctx, admin.accessToken, { stockQuantity: 20 });
    const buyers = await Promise.all(Array.from({ length: 5 }, () => buyerWithAddress(ctx)));
    for (const b of buyers) await addToCart(ctx, b.token, s.listingId, 2);
    const [edit, ...orders] = await Promise.all([
      ctx
        .http()
        .patch(`${API}/vendors/me/listings/${s.listingId}`)
        .set(bearer(s.token))
        .send({ description: 'Edited while selling' }),
      ...buyers.map((b) => checkout(ctx, b.token, b.addressId)),
    ]);
    expect(edit.status).toBe(200);
    expect(orders.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await getStock(ctx, s.listingId)).toBe(10);
  });
});
