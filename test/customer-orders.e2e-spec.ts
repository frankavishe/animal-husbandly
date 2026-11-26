import { OrderExpiryService } from '../src/orders/order-expiry.service';
import { SubOrderTransitionsService } from '../src/orders/sub-order-transitions.service';
import {
  API,
  bearer,
  buyerWithAddress,
  createApp,
  getStock,
  loginAdmin,
  placeOrder,
  registerUser,
  resetUsers,
  shopWithListing,
  TestContext,
} from './utils';

const ORDERS = `${API}/orders`;
const HOUR = 3_600_000;

describe('Customer orders and expiry (US4)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };
  let expiry: OrderExpiryService;
  let transitions: SubOrderTransitionsService;

  const shop = (overrides = {}) => shopWithListing(ctx, admin.accessToken, overrides);
  const cancel = (token: string, orderId: string, subId: string, body: object = {}) =>
    ctx
      .http()
      .post(`${ORDERS}/${orderId}/sub-orders/${subId}/cancel`)
      .set(bearer(token))
      .send(body);
  const vendorAct = (token: string, subId: string, action: string, body?: object) => {
    const req = ctx.http().post(`${API}/vendors/me/orders/${subId}/${action}`).set(bearer(token));
    return body ? req.send(body) : req;
  };
  /** Moves a sub-order's placement time `hours` into the past. */
  const backdate = (subId: string, hours: number) =>
    ctx.prisma.subOrder.update({
      where: { id: subId },
      data: { createdAt: new Date(Date.now() - hours * HOUR) },
    });

  /** A two-shop order. */
  async function twoShopOrder() {
    const a = await shop();
    const b = await shop();
    const buyer = await buyerWithAddress(ctx);
    const order = await placeOrder(ctx, buyer.token, buyer.addressId, [
      { listingId: a.listingId, quantity: 2 },
      { listingId: b.listingId, quantity: 3 },
    ]);
    const subA = order.subOrders.find((s: any) => s.items[0].listingId === a.listingId);
    const subB = order.subOrders.find((s: any) => s.items[0].listingId === b.listingId);
    return { a, b, buyer, order, subA, subB };
  }

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
    expiry = ctx.app.get(OrderExpiryService);
    transitions = ctx.app.get(SubOrderTransitionsService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('lists only own orders, newest first, paginated, filtered by overall status (scenarios 1, 5)', async () => {
    const s = await shop({ stockQuantity: 50 });
    const buyer = await buyerWithAddress(ctx);
    const other = await buyerWithAddress(ctx);
    await placeOrder(ctx, other.token, other.addressId, [{ listingId: s.listingId }]);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(
        (await placeOrder(ctx, buyer.token, buyer.addressId, [{ listingId: s.listingId }])).id,
      );
    }
    const subOf = async (id: string) =>
      (await ctx.prisma.subOrder.findFirstOrThrow({ where: { orderId: id } })).id;
    // ids[0] → COMPLETED, ids[1] → CANCELLED, ids[2] stays OPEN.
    const done = await subOf(ids[0]);
    for (const action of ['confirm', 'dispatch', 'deliver']) {
      await vendorAct(s.token, done, action).expect(200);
    }
    await cancel(buyer.token, ids[1], await subOf(ids[1])).expect(200);

    const all = await ctx.http().get(ORDERS).set(bearer(buyer.token)).expect(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, limit: 20, totalPages: 1 });
    expect(all.body.items.map((o: any) => o.id)).toEqual([...ids].reverse());
    expect(all.body.items.map((o: any) => o.status)).toEqual(['OPEN', 'CANCELLED', 'COMPLETED']);

    for (const [status, expected] of [
      ['OPEN', [ids[2]]],
      ['COMPLETED', [ids[0]]],
      ['CANCELLED', [ids[1]]],
    ] as const) {
      const res = await ctx
        .http()
        .get(`${ORDERS}?status=${status}`)
        .set(bearer(buyer.token))
        .expect(200);
      expect(res.body.items.map((o: any) => o.id)).toEqual(expected);
    }
    const page = await ctx
      .http()
      .get(`${ORDERS}?limit=2&page=2`)
      .set(bearer(buyer.token))
      .expect(200);
    expect(page.body).toMatchObject({ total: 3, totalPages: 2 });
    expect(page.body.items.map((o: any) => o.id)).toEqual([ids[0]]);
    await ctx.http().get(`${ORDERS}?status=PENDING`).set(bearer(buyer.token)).expect(400);
  });

  it('shows items, prices, totals, address, statuses, history and reasons (scenario 2)', async () => {
    const { a, buyer, order, subA } = await twoShopOrder();
    await vendorAct(a.token, subA.id, 'reject', { reason: 'Sold elsewhere' }).expect(200);
    const res = await ctx.http().get(`${ORDERS}/${order.id}`).set(bearer(buyer.token)).expect(200);
    const part = res.body.subOrders.find((s: any) => s.id === subA.id);
    expect(part).toMatchObject({
      status: 'REJECTED',
      reason: 'Sold elsewhere',
      shopSlug: a.vendor.slug,
      items: [{ listingId: a.listingId, quantity: 2, unitPrice: 1200000, lineTotal: 2400000 }],
    });
    expect(part.history.map((h: any) => [h.fromStatus, h.toStatus, h.actor, h.reason])).toEqual([
      [null, 'PENDING', 'CUSTOMER', null],
      ['PENDING', 'REJECTED', 'VENDOR', 'Sold elsewhere'],
    ]);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.total).toBe(5 * 1200000);
  });

  it('cancels a PENDING part, returns its stock and leaves the other part alone (scenario 3)', async () => {
    const { a, b, buyer, order, subA, subB } = await twoShopOrder();
    expect(await getStock(ctx, a.listingId)).toBe(8);
    const res = await cancel(buyer.token, order.id, subA.id, { reason: '  Wrong animal  ' }).expect(
      200,
    );
    const parts = Object.fromEntries(res.body.subOrders.map((s: any) => [s.id, s]));
    expect(parts[subA.id]).toMatchObject({ status: 'CANCELLED', reason: 'Wrong animal' });
    expect(parts[subB.id].status).toBe('PENDING');
    expect(await getStock(ctx, a.listingId)).toBe(10);
    expect(await getStock(ctx, b.listingId)).toBe(7);

    // Reason optional; blank is none; above 500 refused.
    await cancel(buyer.token, order.id, subB.id, { reason: 'x'.repeat(501) }).expect(400);
    const blank = await cancel(buyer.token, order.id, subB.id, { reason: '   ' }).expect(200);
    expect(blank.body.subOrders.find((s: any) => s.id === subB.id).reason).toBeNull();
    expect(blank.body.status).toBe('CANCELLED');
  });

  it('refuses cancelling a part that is not PENDING (scenario 4)', async () => {
    const { a, buyer, order, subA } = await twoShopOrder();
    await vendorAct(a.token, subA.id, 'confirm').expect(200);
    const res = await cancel(buyer.token, order.id, subA.id).expect(409);
    expect(res.body.message).toBe('Cannot cancel an order that is CONFIRMED');
    expect(await getStock(ctx, a.listingId)).toBe(8);
  });

  it("404s for another customer's order and mismatched ids (scenario 6)", async () => {
    const one = await twoShopOrder();
    const two = await twoShopOrder();
    const stranger = await registerUser(ctx);
    await ctx.http().get(`${ORDERS}/${one.order.id}`).set(bearer(stranger.accessToken)).expect(404);
    const res = await cancel(stranger.accessToken, one.order.id, one.subA.id).expect(404);
    expect(res.body.message).toBe('Order not found');
    // A sub-order of another order, even an own one, is not found under this order.
    await cancel(one.buyer.token, one.order.id, two.subA.id).expect(404);
    await cancel(two.buyer.token, one.order.id, two.subA.id).expect(404);
    await cancel(one.buyer.token, 'not-a-uuid', one.subA.id).expect(400);
    await ctx.http().get(ORDERS).set(bearer(admin.accessToken)).expect(403);
    await ctx.http().get(ORDERS).expect(401);
  });

  it('expires PENDING parts after 48 hours, not 47, returning stock (scenario 7)', async () => {
    const { a, b, buyer, order, subA, subB } = await twoShopOrder();
    await backdate(subA.id, 47);
    await backdate(subB.id, 48.01);
    await expiry.run();

    const res = await ctx.http().get(`${ORDERS}/${order.id}`).set(bearer(buyer.token)).expect(200);
    const parts = Object.fromEntries(res.body.subOrders.map((s: any) => [s.id, s]));
    expect(parts[subA.id].status).toBe('PENDING');
    expect(parts[subB.id]).toMatchObject({
      status: 'CANCELLED',
      reason: 'The shop did not respond in time',
    });
    expect(parts[subB.id].history[1]).toMatchObject({
      fromStatus: 'PENDING',
      toStatus: 'CANCELLED',
      actor: 'MARKETPLACE',
    });
    expect(await getStock(ctx, a.listingId)).toBe(8);
    expect(await getStock(ctx, b.listingId)).toBe(10);
    const row = await ctx.prisma.subOrderStatusHistory.findFirstOrThrow({
      where: { subOrderId: subB.id, actorType: 'MARKETPLACE' },
    });
    expect(row.actorId).toBeNull();

    // Confirmed parts never expire.
    await vendorAct(a.token, subA.id, 'confirm').expect(200);
    await backdate(subA.id, 100);
    await expiry.run();
    expect((await ctx.prisma.subOrder.findUniqueOrThrow({ where: { id: subA.id } })).status).toBe(
      'CONFIRMED',
    );
  });

  it('expires despite a suspended shop or deactivated owner or customer', async () => {
    const suspended = await twoShopOrder();
    const ownerOff = await twoShopOrder();
    const customerOff = await twoShopOrder();
    await ctx
      .http()
      .post(`${API}/admin/vendors/${suspended.a.vendor.id}/suspend`)
      .set(bearer(admin.accessToken))
      .expect(200);
    for (const userId of [ownerOff.a.userId, customerOff.buyer.id]) {
      await ctx
        .http()
        .patch(`${API}/admin/users/${userId}/status`)
        .set(bearer(admin.accessToken))
        .send({ isActive: false })
        .expect(200);
    }
    for (const o of [suspended, ownerOff, customerOff]) await backdate(o.subA.id, 49);
    await expiry.run();
    for (const o of [suspended, ownerOff, customerOff]) {
      const sub = await ctx.prisma.subOrder.findUniqueOrThrow({ where: { id: o.subA.id } });
      expect(sub.status).toBe('CANCELLED');
      expect(await getStock(ctx, o.a.listingId)).toBe(10);
    }
  });

  it('returns stock at most once under simultaneous changes', async () => {
    // Two simultaneous expiry runs.
    const runs = await twoShopOrder();
    await backdate(runs.subA.id, 49);
    await Promise.all([expiry.run(), expiry.run()]);
    expect(await getStock(ctx, runs.a.listingId)).toBe(10);
    expect(
      await ctx.prisma.subOrderStatusHistory.count({ where: { subOrderId: runs.subA.id } }),
    ).toBe(2);

    // Customer cancel vs vendor confirm.
    const race = await twoShopOrder();
    const [c, v] = await Promise.all([
      cancel(race.buyer.token, race.order.id, race.subA.id),
      vendorAct(race.a.token, race.subA.id, 'confirm'),
    ]);
    expect([c.status, v.status].sort()).toEqual([200, 409]);
    expect(await getStock(ctx, race.a.listingId)).toBe(c.status === 200 ? 10 : 8);

    // Double cancel.
    const twice = await twoShopOrder();
    const results = await Promise.all([
      cancel(twice.buyer.token, twice.order.id, twice.subA.id),
      cancel(twice.buyer.token, twice.order.id, twice.subA.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await getStock(ctx, twice.a.listingId)).toBe(10);

    // Expiry vs vendor confirm.
    const late = await twoShopOrder();
    await backdate(late.subA.id, 49);
    const [, confirm] = await Promise.all([
      expiry.run(),
      vendorAct(late.a.token, late.subA.id, 'confirm'),
    ]);
    const final = await ctx.prisma.subOrder.findUniqueOrThrow({ where: { id: late.subA.id } });
    expect(final.status).toBe(confirm.status === 200 ? 'CONFIRMED' : 'CANCELLED');
    expect(await getStock(ctx, late.a.listingId)).toBe(final.status === 'CANCELLED' ? 10 : 8);
    expect(
      await ctx.prisma.subOrderStatusHistory.count({ where: { subOrderId: late.subA.id } }),
    ).toBe(2);
  });

  it('never exposes the admin behind a cancellation', async () => {
    const { buyer, order, subA } = await twoShopOrder();
    await transitions.apply({
      subOrderId: subA.id,
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'cancel',
      reason: 'Suspected fraud',
    });
    const res = await ctx.http().get(`${ORDERS}/${order.id}`).set(bearer(buyer.token)).expect(200);
    const part = res.body.subOrders.find((s: any) => s.id === subA.id);
    expect(part.history[1]).toMatchObject({ actor: 'MARKETPLACE', reason: 'Suspected fraud' });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(admin.id);
    expect(json).not.toContain('ADMIN');
    expect(json).not.toContain(process.env.ADMIN_FULL_NAME!);
  });
});
