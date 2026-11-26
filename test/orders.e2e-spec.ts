import { randomUUID } from 'node:crypto';
import { SubOrderTransitionsService } from '../src/orders/sub-order-transitions.service';
import {
  addToCart,
  API,
  bearer,
  buyerWithAddress,
  cartLines,
  checkout,
  createAddress,
  createApp,
  createListing,
  createVendor,
  getStock,
  loginAdmin,
  placeOrder,
  publishListing,
  registerUser,
  resetUsers,
  shopWithListing,
  TestContext,
} from './utils';

const ORDERS = `${API}/orders`;

describe('Checkout (US2)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };
  let transitions: SubOrderTransitionsService;

  const shop = (overrides = {}) => shopWithListing(ctx, admin.accessToken, overrides);
  const getCart = async (token: string) =>
    (await ctx.http().get(`${API}/cart`).set(bearer(token)).expect(200)).body;
  const orderCount = (customerId: string) => ctx.prisma.order.count({ where: { customerId } });

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
    transitions = ctx.app.get(SubOrderTransitionsService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('places a two-shop order: two PENDING parts, stock taken, cart emptied (scenario 1)', async () => {
    const a = await shop({ unitPrice: 1200000, stockQuantity: 5 });
    const b = await shop({ unitPrice: 300000, stockQuantity: 4 });
    const buyer = await buyerWithAddress(ctx);
    await addToCart(ctx, buyer.token, a.listingId, 2);
    await addToCart(ctx, buyer.token, b.listingId, 3);

    const res = await checkout(ctx, buyer.token, buyer.addressId);
    expect(res.status).toBe(201);
    const order = res.body;
    expect(order).toMatchObject({
      orderNumber: expect.stringMatching(/^ORD-\d{8,}$/),
      status: 'OPEN',
      paymentMethod: 'CASH_ON_DELIVERY',
      total: 2 * 1200000 + 3 * 300000,
      deliveryAddress: {
        recipientName: 'Asha Mushi',
        regionName: expect.any(String),
        districtName: expect.any(String),
        wardStreet: 'Sakina, Mianzini Street',
        landmark: 'Near the market',
      },
    });
    expect(order.subOrders).toHaveLength(2);
    for (const s of order.subOrders) {
      expect(s.status).toBe('PENDING');
      expect(s.history).toEqual([
        {
          fromStatus: null,
          toStatus: 'PENDING',
          actor: 'CUSTOMER',
          reason: null,
          createdAt: expect.any(String),
        },
      ]);
    }
    // SC-006: total = Σ subtotals = Σ line totals; line total = price × quantity.
    const subtotals = order.subOrders.map((s: any) => s.subtotal);
    const lines = order.subOrders.flatMap((s: any) => s.items);
    expect(subtotals.reduce((x: number, y: number) => x + y, 0)).toBe(order.total);
    expect(lines.reduce((x: number, l: any) => x + l.lineTotal, 0)).toBe(order.total);
    for (const l of lines) expect(l.lineTotal).toBe(l.unitPrice * l.quantity);
    expect(lines.find((l: any) => l.listingId === a.listingId)).toMatchObject({
      title: 'Boran heifer',
      species: 'CATTLE',
      listingType: 'LIVE_ANIMAL',
      unit: 'HEAD',
      unitPrice: 1200000,
      quantity: 2,
    });

    expect(await getStock(ctx, a.listingId)).toBe(3);
    expect(await getStock(ctx, b.listingId)).toBe(1);
    expect((await getCart(buyer.token)).lineCount).toBe(0);

    const fetched = await ctx
      .http()
      .get(`${ORDERS}/${order.id}`)
      .set(bearer(buyer.token))
      .expect(200);
    expect(fetched.body).toEqual(order);
  });

  it('refuses unavailable and short lines naming each; nothing changes; key stays usable (scenario 2)', async () => {
    const paused = await shop();
    const short = await shop({ stockQuantity: 5 });
    const fine = await shop();
    const buyer = await buyerWithAddress(ctx);
    for (const [s, q] of [
      [paused, 1],
      [short, 4],
      [fine, 1],
    ] as const) {
      await addToCart(ctx, buyer.token, s.listingId, q);
    }
    const lines = await cartLines(ctx, buyer.token);
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

    const key = randomUUID();
    const res = await checkout(ctx, buyer.token, buyer.addressId, { lines, submissionKey: key });
    expect(res.status).toBe(409);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        `"Boran heifer" (${paused.listingId}) is no longer available`,
        `"Boran heifer" (${short.listingId}): only 2 left (you asked for 4)`,
      ]),
    );
    expect(res.body.message).toHaveLength(2);
    expect(await getStock(ctx, fine.listingId)).toBe(10);
    expect(await getStock(ctx, short.listingId)).toBe(2);
    expect((await getCart(buyer.token)).lineCount).toBe(3);
    expect(await orderCount(buyer.id)).toBe(0);

    // Fix the cart and retry with the same key.
    await ctx
      .http()
      .delete(`${API}/cart/items/${paused.listingId}`)
      .set(bearer(buyer.token))
      .expect(200);
    await ctx
      .http()
      .patch(`${API}/cart/items/${short.listingId}`)
      .set(bearer(buyer.token))
      .send({ quantity: 2 })
      .expect(200);
    const ok = await checkout(ctx, buyer.token, buyer.addressId, { submissionKey: key });
    expect(ok.status).toBe(201);
  });

  it('refuses old prices even when the total is unchanged, then places at current prices (scenario 3)', async () => {
    const a = await shop({ unitPrice: 1000 });
    const b = await shop({ unitPrice: 1000 });
    const buyer = await buyerWithAddress(ctx);
    await addToCart(ctx, buyer.token, a.listingId, 1);
    await addToCart(ctx, buyer.token, b.listingId, 1);
    const seen = await cartLines(ctx, buyer.token);
    for (const [s, price] of [
      [a, 1200],
      [b, 800],
    ] as const) {
      await ctx
        .http()
        .patch(`${API}/vendors/me/listings/${s.listingId}`)
        .set(bearer(s.token))
        .send({ unitPrice: price })
        .expect(200);
    }
    const res = await checkout(ctx, buyer.token, buyer.addressId, { lines: seen });
    expect(res.status).toBe(409);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        `"Boran heifer" (${a.listingId}): price is now 1200 (you confirmed 1000)`,
        `"Boran heifer" (${b.listingId}): price is now 800 (you confirmed 1000)`,
      ]),
    );

    const placed = await checkout(ctx, buyer.token, buyer.addressId);
    expect(placed.status).toBe(201);
    expect(placed.body.total).toBe(2000);
    const prices = placed.body.subOrders.flatMap((s: any) => s.items.map((i: any) => i.unitPrice));
    expect(prices.sort()).toEqual([1200, 800].sort());
  });

  it('refuses missing, extra and different lines', async () => {
    const a = await shop();
    const b = await shop();
    const buyer = await buyerWithAddress(ctx);
    await addToCart(ctx, buyer.token, a.listingId, 2);
    const res = await checkout(ctx, buyer.token, buyer.addressId, {
      lines: [
        { listingId: a.listingId, quantity: 1, unitPrice: 1200000 },
        { listingId: b.listingId, quantity: 1, unitPrice: 1200000 },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toEqual([
      `"Boran heifer" (${a.listingId}): quantity in your cart is 2 (you confirmed 1)`,
      `Listing ${b.listingId} is not in your cart`,
    ]);
    const missing = await checkout(ctx, buyer.token, buyer.addressId, {
      lines: [{ listingId: b.listingId, quantity: 1, unitPrice: 1200000 }],
    });
    expect(missing.body.message).toEqual([
      `"Boran heifer" (${a.listingId}) is in your cart but was not confirmed`,
      `Listing ${b.listingId} is not in your cart`,
    ]);
  });

  it('replays the same key once and refuses it with different data (scenario 5)', async () => {
    const s = await shop();
    const buyer = await buyerWithAddress(ctx);
    const otherAddress = await createAddress(ctx, buyer.token);
    await addToCart(ctx, buyer.token, s.listingId, 2);
    const lines = await cartLines(ctx, buyer.token);
    const key = randomUUID();

    const first = await checkout(ctx, buyer.token, buyer.addressId, { lines, submissionKey: key });
    expect(first.status).toBe(201);
    const again = await checkout(ctx, buyer.token, buyer.addressId, { lines, submissionKey: key });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await getStock(ctx, s.listingId)).toBe(8);
    expect(await orderCount(buyer.id)).toBe(1);

    const otherAddr = await checkout(ctx, buyer.token, otherAddress, { lines, submissionKey: key });
    expect(otherAddr.status).toBe(409);
    expect(otherAddr.body.message).toBe(
      'This submission key was already used with a different address or lines',
    );
    const otherLines = await checkout(ctx, buyer.token, buyer.addressId, {
      lines: [{ ...lines[0], quantity: 1 }],
      submissionKey: key,
    });
    expect(otherLines.status).toBe(409);

    // Keys of different users are independent.
    const other = await buyerWithAddress(ctx);
    await addToCart(ctx, other.token, s.listingId, 1);
    expect((await checkout(ctx, other.token, other.addressId, { submissionKey: key })).status).toBe(
      201,
    );

    // Replay still works after the address is deleted.
    await ctx
      .http()
      .delete(`${API}/users/me/addresses/${buyer.addressId}`)
      .set(bearer(buyer.token))
      .expect(204);
    const replay = await checkout(ctx, buyer.token, buyer.addressId, { lines, submissionKey: key });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('refuses an empty cart and a missing or foreign address (scenario 6)', async () => {
    const s = await shop();
    const buyer = await buyerWithAddress(ctx);
    const line = { listingId: s.listingId, quantity: 1, unitPrice: 1200000 };
    const empty = await checkout(ctx, buyer.token, buyer.addressId, { lines: [line] });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe('Your cart is empty');

    await addToCart(ctx, buyer.token, s.listingId, 1);
    const stranger = await buyerWithAddress(ctx);
    for (const addressId of [stranger.addressId, randomUUID()]) {
      const res = await checkout(ctx, buyer.token, addressId);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Address not found');
    }
    expect(await getStock(ctx, s.listingId)).toBe(10);
    expect((await getCart(buyer.token)).lineCount).toBe(1);
  });

  it('validates the body', async () => {
    const s = await shop();
    const buyer = await buyerWithAddress(ctx);
    await addToCart(ctx, buyer.token, s.listingId, 1);
    const line = { listingId: s.listingId, quantity: 1, unitPrice: 1200000 };
    const send = (body: object) => ctx.http().post(ORDERS).set(bearer(buyer.token)).send(body);
    const base = { addressId: buyer.addressId, submissionKey: randomUUID(), lines: [line] };
    for (const body of [
      { ...base, lines: [] },
      { ...base, lines: [line, line] },
      { ...base, lines: Array.from({ length: 51 }, () => ({ ...line, listingId: randomUUID() })) },
      { ...base, submissionKey: 'abc' },
      { ...base, addressId: 'abc' },
      { ...base, lines: [{ ...line, quantity: 0 }] },
      { ...base, lines: [{ ...line, unitPrice: 1.5 }] },
      { ...base, lines: [{ ...line, extra: 1 }] },
      { ...base, paymentMethod: 'CARD' },
    ]) {
      await send(body).expect(400);
    }
    await ctx.http().post(ORDERS).send(base).expect(401);
    await ctx.http().post(ORDERS).set(bearer(admin.accessToken)).send(base).expect(403);
    await ctx.http().get(`${ORDERS}/not-a-uuid`).set(bearer(buyer.token)).expect(400);
  });

  it('keeps the order as placed after listing and address changes (scenario 7)', async () => {
    const s = await shop({ unitPrice: 1000 });
    const buyer = await buyerWithAddress(ctx);
    const order = await placeOrder(ctx, buyer.token, buyer.addressId, [{ listingId: s.listingId }]);

    await ctx
      .http()
      .patch(`${API}/vendors/me/listings/${s.listingId}`)
      .set(bearer(s.token))
      .send({ title: 'Renamed', unitPrice: 5000 })
      .expect(200);
    await ctx
      .http()
      .post(`${API}/vendors/me/listings/${s.listingId}/archive`)
      .set(bearer(s.token))
      .expect(200);
    await ctx
      .http()
      .patch(`${API}/users/me/addresses/${buyer.addressId}`)
      .set(bearer(buyer.token))
      .send({ recipientName: 'Someone Else', wardStreet: 'Elsewhere' })
      .expect(200);

    const res = await ctx.http().get(`${ORDERS}/${order.id}`).set(bearer(buyer.token)).expect(200);
    expect(res.body).toEqual(order);
  });

  it("404s for another customer's order", async () => {
    const s = await shop();
    const buyer = await buyerWithAddress(ctx);
    const order = await placeOrder(ctx, buyer.token, buyer.addressId, [{ listingId: s.listingId }]);
    const other = await registerUser(ctx);
    const res = await ctx
      .http()
      .get(`${ORDERS}/${order.id}`)
      .set(bearer(other.accessToken))
      .expect(404);
    expect(res.body.message).toBe('Order not found');
  });

  it('refuses a total above 10,000,000,000 (scenario 8)', async () => {
    const s = await shop({ unitPrice: 1_000_000_000, stockQuantity: 11 });
    const buyer = await buyerWithAddress(ctx);
    const cart = await addToCart(ctx, buyer.token, s.listingId, 11);
    expect(cart.exceedsMaxTotal).toBe(true);
    const res = await checkout(ctx, buyer.token, buyer.addressId);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('The order total is above the maximum of 10000000000 TZS');
    expect(await getStock(ctx, s.listingId)).toBe(11);

    await ctx
      .http()
      .patch(`${API}/cart/items/${s.listingId}`)
      .set(bearer(buyer.token))
      .send({ quantity: 10 })
      .expect(200);
    const ok = await checkout(ctx, buyer.token, buyer.addressId);
    expect(ok.status).toBe(201);
    expect(ok.body.total).toBe(10_000_000_000);
  });

  it('limits a customer to 10 OPEN orders; replay still works at the limit (scenario 9)', async () => {
    const s = await shop({ stockQuantity: 100, unitPrice: 1000 });
    const buyer = await buyerWithAddress(ctx);
    const orders: any[] = [];
    let firstKey = '';
    let firstLines: any[] = [];
    for (let i = 0; i < 10; i += 1) {
      await addToCart(ctx, buyer.token, s.listingId, 1);
      const lines = await cartLines(ctx, buyer.token);
      const key = randomUUID();
      if (i === 0) [firstKey, firstLines] = [key, lines];
      const res = await checkout(ctx, buyer.token, buyer.addressId, { lines, submissionKey: key });
      expect(res.status).toBe(201);
      orders.push(res.body);
    }
    await addToCart(ctx, buyer.token, s.listingId, 1);
    const refused = await checkout(ctx, buyer.token, buyer.addressId);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe(
      'You already have 10 open orders; wait until one is completed or cancelled',
    );
    expect(await getStock(ctx, s.listingId)).toBe(90);

    const replay = await checkout(ctx, buyer.token, buyer.addressId, {
      lines: firstLines,
      submissionKey: firstKey,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(orders[0].id);

    await transitions.apply({
      subOrderId: orders[0].subOrders[0].id,
      actorType: 'CUSTOMER',
      actorId: buyer.id,
      action: 'cancel',
    });
    expect((await checkout(ctx, buyer.token, buyer.addressId)).status).toBe(201);
  });

  it('lets a vendor buy from another shop but not their own', async () => {
    const other = await shop();
    const { user } = await createVendor(ctx, admin.accessToken, { approve: true });
    const own = await createListing(ctx, user.accessToken);
    await publishListing(ctx, user.accessToken, own.id);
    const addressId = await createAddress(ctx, user.accessToken);
    await addToCart(ctx, user.accessToken, other.listingId, 1);
    expect((await checkout(ctx, user.accessToken, addressId)).status).toBe(201);
    // A listing of the vendor's own shop can never get into the cart.
    await ctx
      .http()
      .post(`${API}/cart/items`)
      .set(bearer(user.accessToken))
      .send({ listingId: own.id, quantity: 1 })
      .expect(403);
  });

  describe('database integrity', () => {
    let order: any;
    let s: Awaited<ReturnType<typeof shop>>;
    let buyer: Awaited<ReturnType<typeof buyerWithAddress>>;

    beforeAll(async () => {
      s = await shop();
      buyer = await buyerWithAddress(ctx);
      order = await placeOrder(ctx, buyer.token, buyer.addressId, [{ listingId: s.listingId }]);
    });

    it.each([
      ['cart_items_quantity', `UPDATE cart_items SET quantity = 0`],
      ['cart_items_quantity', `UPDATE cart_items SET last_seen_price = 0`],
      ['orders_total', `UPDATE orders SET total = 10000000001 WHERE id = $1::uuid`],
      ['orders_total', `UPDATE orders SET total = 0 WHERE id = $1::uuid`],
      ['sub_orders_subtotal', `UPDATE sub_orders SET subtotal = 0 WHERE order_id = $1::uuid`],
      [
        'sub_orders_cash_collected',
        `UPDATE sub_orders SET status = 'DELIVERED' WHERE order_id = $1::uuid`,
      ],
      [
        'sub_orders_cash_collected',
        `UPDATE sub_orders SET cash_collected_at = now() WHERE order_id = $1::uuid`,
      ],
      [
        'order_items_line_total',
        `UPDATE order_items SET line_total = line_total + 1 WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE order_id = $1::uuid)`,
      ],
      [
        'order_items_line_total',
        `UPDATE order_items SET quantity = 0, line_total = 0 WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE order_id = $1::uuid)`,
      ],
      [
        'sub_order_history_actor',
        `UPDATE sub_order_status_history SET actor_id = NULL WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE order_id = $1::uuid)`,
      ],
      [
        'sub_order_history_actor',
        `UPDATE sub_order_status_history SET actor_type = 'MARKETPLACE' WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE order_id = $1::uuid)`,
      ],
      [
        'sub_order_history_actor',
        `UPDATE sub_order_status_history SET reason = repeat('x', 501) WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE order_id = $1::uuid)`,
      ],
    ])('CHECK %s rejects: %s', async (name, sql) => {
      if (name === 'cart_items_quantity') {
        // Needs a cart line to violate.
        await addToCart(ctx, buyer.token, s.listingId, 1);
      }
      const args = sql.includes('$1') ? [order.id] : [];
      await expect(ctx.prisma.$executeRawUnsafe(sql, ...args)).rejects.toThrow(name);
    });

    it('refuses to delete an ordered listing, its shop or the buyer (RESTRICT)', async () => {
      await expect(ctx.prisma.listing.delete({ where: { id: s.listingId } })).rejects.toThrow();
      await expect(ctx.prisma.vendor.delete({ where: { id: s.vendor.id } })).rejects.toThrow();
      await expect(ctx.prisma.user.delete({ where: { id: buyer.id } })).rejects.toThrow();
      await expect(ctx.prisma.user.delete({ where: { id: s.userId } })).rejects.toThrow();
      const res = await ctx
        .http()
        .get(`${ORDERS}/${order.id}`)
        .set(bearer(buyer.token))
        .expect(200);
      expect(res.body).toEqual(order);
    });
  });
});
