import {
  addToCart,
  API,
  bearer,
  createApp,
  createListing,
  createVendor,
  getStock,
  loginAdmin,
  publishListing,
  registerUser,
  resetUsers,
  TestContext,
} from './utils';

const CART = `${API}/cart`;

describe('Cart (US1)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };

  /** An approved shop with one ACTIVE listing. */
  async function shopWithListing(overrides: Record<string, unknown> = {}) {
    const { user, vendor } = await createVendor(ctx, admin.accessToken, { approve: true });
    const listing = await createListing(ctx, user.accessToken, { stockQuantity: 10, ...overrides });
    await publishListing(ctx, user.accessToken, listing.id);
    return { token: user.accessToken, userId: user.id, vendor, listingId: listing.id as string };
  }

  const get = (token: string) => ctx.http().get(CART).set(bearer(token));
  const add = (token: string, listingId: string, quantity: unknown) =>
    ctx.http().post(`${CART}/items`).set(bearer(token)).send({ listingId, quantity });
  const set = (token: string, listingId: string, quantity: unknown) =>
    ctx.http().patch(`${CART}/items/${listingId}`).set(bearer(token)).send({ quantity });
  const line = (body: any, listingId: string) =>
    (body.shops as any[]).flatMap((s) => s.lines).find((l: any) => l.listingId === listingId);

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('starts empty', async () => {
    const buyer = await registerUser(ctx);
    const res = await get(buyer.accessToken).expect(200);
    expect(res.body).toEqual({ shops: [], total: 0, lineCount: 0, exceedsMaxTotal: false });
  });

  it('adds, combines and refuses above stock without changing the line (scenarios 1–2)', async () => {
    const shop = await shopWithListing({ unitPrice: 1000 });
    const buyer = await registerUser(ctx);

    let res = await add(buyer.accessToken, shop.listingId, 3).expect(200);
    expect(line(res.body, shop.listingId)).toEqual({
      listingId: shop.listingId,
      title: 'Boran heifer',
      unit: 'HEAD',
      quantity: 3,
      unitPrice: 1000,
      lineTotal: 3000,
      stockLeft: 10,
      previousPrice: null,
      flags: [],
    });

    res = await add(buyer.accessToken, shop.listingId, 2).expect(200);
    expect(line(res.body, shop.listingId).quantity).toBe(5);
    expect(res.body.lineCount).toBe(1);

    res = await add(buyer.accessToken, shop.listingId, 6).expect(409);
    expect(res.body.message).toBe(
      'Only 10 of "Boran heifer" in stock (you already have 5 in your cart)',
    );
    res = await get(buyer.accessToken).expect(200);
    expect(line(res.body, shop.listingId).quantity).toBe(5);
    expect(await getStock(ctx, shop.listingId)).toBe(10);
  });

  it('sets quantities and validates them (scenario 3)', async () => {
    const shop = await shopWithListing();
    const buyer = await registerUser(ctx);
    await addToCart(ctx, buyer.accessToken, shop.listingId, 1);

    const res = await set(buyer.accessToken, shop.listingId, 4).expect(200);
    expect(line(res.body, shop.listingId).quantity).toBe(4);

    for (const bad of [0, -1, 1.5, '2', 1_000_001]) {
      await set(buyer.accessToken, shop.listingId, bad).expect(400);
    }
    const above = await set(buyer.accessToken, shop.listingId, 11).expect(409);
    expect(above.body.message).toBe('Only 10 of "Boran heifer" in stock');
    expect(line((await get(buyer.accessToken)).body, shop.listingId).quantity).toBe(4);

    const other = await shopWithListing();
    await set(buyer.accessToken, other.listingId, 1).expect(404);
  });

  it('rejects invalid bodies and unknown fields', async () => {
    const shop = await shopWithListing();
    const buyer = await registerUser(ctx);
    await add(buyer.accessToken, 'not-a-uuid', 1).expect(400);
    await add(buyer.accessToken, shop.listingId, 0).expect(400);
    await ctx
      .http()
      .post(`${CART}/items`)
      .set(bearer(buyer.accessToken))
      .send({ listingId: shop.listingId, quantity: 1, unitPrice: 1 })
      .expect(400);
    await set(buyer.accessToken, 'not-a-uuid', 1).expect(400);
  });

  it('groups by shop with subtotals and a total (scenario 4)', async () => {
    const a = await shopWithListing({ unitPrice: 1000 });
    const b = await shopWithListing({ unitPrice: 250 });
    const buyer = await registerUser(ctx);
    await addToCart(ctx, buyer.accessToken, a.listingId, 2);
    const res = await add(buyer.accessToken, b.listingId, 4).expect(200);
    expect(res.body.shops).toHaveLength(2);
    expect(res.body.shops.map((s: any) => [s.shop.slug, s.subtotal])).toEqual([
      [a.vendor.slug, 2000],
      [b.vendor.slug, 1000],
    ]);
    expect(res.body).toMatchObject({ total: 3000, lineCount: 2, exceedsMaxTotal: false });
  });

  it('404s for invisible listings and 409s when out of stock (scenario 5)', async () => {
    const { user } = await createVendor(ctx, admin.accessToken, { approve: true });
    const draft = await createListing(ctx, user.accessToken);
    const buyer = await registerUser(ctx);
    const res = await add(buyer.accessToken, draft.id, 1).expect(404);
    expect(res.body.message).toBe('Listing not found');
    await add(buyer.accessToken, '00000000-0000-4000-8000-000000000000', 1).expect(404);

    const empty = await shopWithListing({ stockQuantity: 0 });
    const out = await add(buyer.accessToken, empty.listingId, 1).expect(409);
    expect(out.body.message).toBe('"Boran heifer" is out of stock');
  });

  it('refuses the own shop and accepts another shop for a vendor (scenario 6)', async () => {
    const mine = await shopWithListing();
    const other = await shopWithListing();
    const res = await add(mine.token, mine.listingId, 1).expect(403);
    expect(res.body.message).toBe('You cannot buy from your own shop');
    await add(mine.token, other.listingId, 1).expect(200);
  });

  it('keeps and flags lines that become unavailable, short or repriced (scenario 7)', async () => {
    const paused = await shopWithListing();
    const short = await shopWithListing();
    const repriced = await shopWithListing({ unitPrice: 1000 });
    const suspended = await shopWithListing();
    const takenDown = await shopWithListing();
    const buyer = await registerUser(ctx);
    for (const s of [paused, short, repriced, suspended, takenDown]) {
      await addToCart(ctx, buyer.accessToken, s.listingId, 5);
    }

    await ctx
      .http()
      .post(`${API}/vendors/me/listings/${paused.listingId}/pause`)
      .set(bearer(paused.token))
      .expect(200);
    await ctx
      .http()
      .patch(`${API}/vendors/me/listings/${short.listingId}`)
      .set(bearer(short.token))
      .send({ stockQuantity: 2 })
      .expect(200);
    await ctx
      .http()
      .patch(`${API}/vendors/me/listings/${repriced.listingId}`)
      .set(bearer(repriced.token))
      .send({ unitPrice: 1300 })
      .expect(200);
    await ctx
      .http()
      .post(`${API}/admin/vendors/${suspended.vendor.id}/suspend`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await ctx
      .http()
      .post(`${API}/admin/listings/${takenDown.listingId}/take-down`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'Selling sick animals' })
      .expect(200);

    const res = await get(buyer.accessToken).expect(200);
    expect(res.body.lineCount).toBe(5);
    for (const s of [paused, suspended, takenDown]) {
      expect(line(res.body, s.listingId)).toEqual({
        listingId: s.listingId,
        title: 'Boran heifer',
        unit: 'HEAD',
        quantity: 5,
        unitPrice: null,
        lineTotal: null,
        stockLeft: null,
        previousPrice: null,
        flags: ['UNAVAILABLE'],
      });
    }
    const body = JSON.stringify(res.body);
    for (const hidden of ['Selling sick animals', 'TAKEN_DOWN', 'SUSPENDED', 'INACTIVE']) {
      expect(body).not.toContain(hidden);
    }
    expect(line(res.body, short.listingId)).toMatchObject({
      flags: ['SHORT_OF_STOCK'],
      stockLeft: 2,
    });
    expect(line(res.body, repriced.listingId)).toMatchObject({
      flags: ['PRICE_CHANGED'],
      unitPrice: 1300,
      previousPrice: 1000,
      lineTotal: 6500,
    });
    // Unavailable lines are excluded from totals.
    expect(res.body.total).toBe(5 * 1200000 + 6500);

    // Setting the line again clears the price flag.
    const after = await set(buyer.accessToken, repriced.listingId, 5).expect(200);
    expect(line(after.body, repriced.listingId).flags).toEqual([]);
    // An unavailable line can be removed but not changed.
    await set(buyer.accessToken, paused.listingId, 1).expect(404);
    await ctx
      .http()
      .delete(`${CART}/items/${paused.listingId}`)
      .set(bearer(buyer.accessToken))
      .expect(200);
  });

  it('removes lines and clears the cart without touching stock (scenario 8)', async () => {
    const a = await shopWithListing();
    const b = await shopWithListing();
    const buyer = await registerUser(ctx);
    await addToCart(ctx, buyer.accessToken, a.listingId, 2);
    await addToCart(ctx, buyer.accessToken, b.listingId, 3);

    let res = await ctx
      .http()
      .delete(`${CART}/items/${a.listingId}`)
      .set(bearer(buyer.accessToken))
      .expect(200);
    expect(res.body.lineCount).toBe(1);
    await ctx
      .http()
      .delete(`${CART}/items/${a.listingId}`)
      .set(bearer(buyer.accessToken))
      .expect(404);

    res = await ctx.http().delete(CART).set(bearer(buyer.accessToken)).expect(200);
    expect(res.body).toEqual({ shops: [], total: 0, lineCount: 0, exceedsMaxTotal: false });
    expect(await getStock(ctx, a.listingId)).toBe(10);
    expect(await getStock(ctx, b.listingId)).toBe(10);
  });

  it('denies anonymous (401) and admin (403) access; carts are private (scenario 9)', async () => {
    const shop = await shopWithListing();
    await ctx.http().get(CART).expect(401);
    await ctx
      .http()
      .post(`${CART}/items`)
      .send({ listingId: shop.listingId, quantity: 1 })
      .expect(401);
    await get(admin.accessToken).expect(403);
    await add(admin.accessToken, shop.listingId, 1).expect(403);
    await ctx.http().delete(CART).set(bearer(admin.accessToken)).expect(403);

    const one = await registerUser(ctx);
    const two = await registerUser(ctx);
    await addToCart(ctx, one.accessToken, shop.listingId, 2);
    await addToCart(ctx, two.accessToken, shop.listingId, 1);
    await ctx.http().delete(CART).set(bearer(two.accessToken)).expect(200);
    const res = await get(one.accessToken).expect(200);
    expect(line(res.body, shop.listingId).quantity).toBe(2);
  });

  it('combines simultaneous adds into one line within stock', async () => {
    const shop = await shopWithListing();
    const buyer = await registerUser(ctx);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => add(buyer.accessToken, shop.listingId, 2)),
    );
    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(results.some((r) => r.status >= 500)).toBe(false);
    const res = await get(buyer.accessToken).expect(200);
    expect(res.body.lineCount).toBe(1);
    expect(line(res.body, shop.listingId).quantity).toBe(10);
    expect(await getStock(ctx, shop.listingId)).toBe(10);
  });

  it('refuses a 51st line', async () => {
    const { user } = await createVendor(ctx, admin.accessToken, { approve: true });
    const buyer = await registerUser(ctx);
    const ids: string[] = [];
    for (let i = 0; i < 51; i += 1) {
      const l = await createListing(ctx, user.accessToken, { title: `Animal ${i}` });
      await publishListing(ctx, user.accessToken, l.id);
      ids.push(l.id);
    }
    for (const id of ids.slice(0, 50)) await addToCart(ctx, buyer.accessToken, id, 1);
    const res = await add(buyer.accessToken, ids[50], 1).expect(409);
    expect(res.body.message).toBe('Your cart can hold at most 50 different listings');
    // Adding to an existing line is still fine.
    await add(buyer.accessToken, ids[0], 1).expect(200);
  });
});
