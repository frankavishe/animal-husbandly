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

const ADMIN_ORDERS = `${API}/admin/orders`;

describe('Admin orders (US5)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };

  const shop = (overrides = {}) => shopWithListing(ctx, admin.accessToken, overrides);
  const list = (query = '') =>
    ctx.http().get(`${ADMIN_ORDERS}${query}`).set(bearer(admin.accessToken));
  const adminCancel = (orderId: string, subId: string, body: object) =>
    ctx
      .http()
      .post(`${ADMIN_ORDERS}/${orderId}/sub-orders/${subId}/cancel`)
      .set(bearer(admin.accessToken))
      .send(body);
  const vendorAct = (token: string, subId: string, action: string) =>
    ctx.http().post(`${API}/vendors/me/orders/${subId}/${action}`).set(bearer(token));
  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((o) => o.id);

  async function ordered(quantity = 2) {
    const s = await shop();
    const buyer = await buyerWithAddress(ctx);
    const order = await placeOrder(ctx, buyer.token, buyer.addressId, [
      { listingId: s.listingId, quantity },
    ]);
    return { s, buyer, order, subId: order.subOrders[0].id as string };
  }

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('listing and filters (scenario 1)', () => {
    let a: Awaited<ReturnType<typeof ordered>>;
    let b: Awaited<ReturnType<typeof ordered>>;
    let c: Awaited<ReturnType<typeof ordered>>;

    beforeAll(async () => {
      await resetUsers(ctx.prisma);
      admin = await loginAdmin(ctx);
      a = await ordered(); // stays PENDING (OPEN), placed 2026-10-15
      b = await ordered(); // DELIVERED (COMPLETED)
      c = await ordered(); // REJECTED (CANCELLED)
      for (const action of ['confirm', 'dispatch', 'deliver']) {
        await vendorAct(b.s.token, b.subId, action).expect(200);
      }
      await ctx
        .http()
        .post(`${API}/vendors/me/orders/${c.subId}/reject`)
        .set(bearer(c.s.token))
        .send({ reason: 'No' })
        .expect(200);
      await ctx.prisma.order.update({
        where: { id: a.order.id },
        data: { createdAt: new Date('2026-10-15T23:30:00Z') },
      });
    });

    it('lists all, newest first, paginated', async () => {
      const res = await list().expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, limit: 20, totalPages: 1 });
      expect(ids(res)).toEqual([c.order.id, b.order.id, a.order.id]);
      const page = await list('?limit=2&page=2').expect(200);
      expect(ids(page)).toEqual([a.order.id]);
    });

    it('filters by overall status', async () => {
      expect(ids(await list('?status=OPEN').expect(200))).toEqual([a.order.id]);
      expect(ids(await list('?status=COMPLETED').expect(200))).toEqual([b.order.id]);
      expect(ids(await list('?status=CANCELLED').expect(200))).toEqual([c.order.id]);
    });

    it('filters by sub-order status, shop and customer', async () => {
      expect(ids(await list('?subOrderStatus=DELIVERED').expect(200))).toEqual([b.order.id]);
      expect(ids(await list(`?vendorId=${c.s.vendor.id}`).expect(200))).toEqual([c.order.id]);
      expect(ids(await list(`?customerId=${a.buyer.id}`).expect(200))).toEqual([a.order.id]);
      expect(
        ids(await list(`?vendorId=${b.s.vendor.id}&subOrderStatus=DELIVERED`).expect(200)),
      ).toEqual([b.order.id]);
      expect(
        ids(await list(`?vendorId=${b.s.vendor.id}&subOrderStatus=PENDING`).expect(200)),
      ).toEqual([]);
    });

    it('filters by placement dates, inclusive of whole days', async () => {
      expect(ids(await list('?from=2026-10-15&to=2026-10-15').expect(200))).toEqual([a.order.id]);
      expect(ids(await list('?to=2026-10-15').expect(200))).toEqual([a.order.id]);
      expect(ids(await list('?from=2026-10-16').expect(200))).toEqual([c.order.id, b.order.id]);
      const res = await list('?from=2026-10-16&to=2026-10-15').expect(400);
      expect(res.body.message).toBe('from must not be after to');
      for (const bad of ['?from=yesterday', '?to=2026-13-01', '?from=2026-10-15T00:00:00Z']) {
        await list(bad).expect(400);
      }
      await list('?vendorId=abc').expect(400);
      await list('?status=PENDING').expect(400);
    });
  });

  it('shows any order in full (scenario 2)', async () => {
    const { s, buyer, order, subId } = await ordered();
    await vendorAct(s.token, subId, 'confirm').expect(200);
    const res = await ctx
      .http()
      .get(`${ADMIN_ORDERS}/${order.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      id: order.id,
      orderNumber: order.orderNumber,
      status: 'OPEN',
      total: order.total,
      deliveryAddress: order.deliveryAddress,
      customer: { id: buyer.id, fullName: 'Test User', phone: buyer.phone, email: null },
    });
    expect(res.body.subOrders[0].vendor).toEqual({
      id: s.vendor.id,
      slug: s.vendor.slug,
      shopName: expect.any(String),
    });
    expect(res.body.subOrders[0].history).toEqual([
      expect.objectContaining({
        actor: 'CUSTOMER',
        actorUser: { id: buyer.id, fullName: 'Test User' },
      }),
      expect.objectContaining({
        actor: 'VENDOR',
        actorUser: { id: s.userId, fullName: 'Test User' },
      }),
    ]);
    await ctx
      .http()
      .get(`${ADMIN_ORDERS}/00000000-0000-4000-8000-000000000000`)
      .set(bearer(admin.accessToken))
      .expect(404);
  });

  it('cancels PENDING, CONFIRMED and DISPATCHED with a reason; stock returns except from DISPATCHED (scenario 3)', async () => {
    const pending = await ordered(2);
    const confirmed = await ordered(2);
    const dispatched = await ordered(2);
    await vendorAct(confirmed.s.token, confirmed.subId, 'confirm').expect(200);
    await vendorAct(dispatched.s.token, dispatched.subId, 'confirm').expect(200);
    await vendorAct(dispatched.s.token, dispatched.subId, 'dispatch').expect(200);

    for (const body of [{}, { reason: '' }, { reason: 'z'.repeat(501) }]) {
      await adminCancel(pending.order.id, pending.subId, body).expect(400);
    }

    for (const [o, stock] of [
      [pending, 10],
      [confirmed, 10],
      [dispatched, 8],
    ] as const) {
      const before = Date.now();
      const res = await adminCancel(o.order.id, o.subId, { reason: 'Shop unreachable' }).expect(
        200,
      );
      const part = res.body.subOrders[0];
      expect(part).toMatchObject({ status: 'CANCELLED', reason: 'Shop unreachable' });
      const last = part.history[part.history.length - 1];
      expect(last).toMatchObject({
        toStatus: 'CANCELLED',
        actor: 'ADMIN',
        actorUser: { id: admin.id, fullName: process.env.ADMIN_FULL_NAME },
        reason: 'Shop unreachable',
      });
      expect(new Date(last.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(await getStock(ctx, o.s.listingId)).toBe(stock);

      // Customer and vendor see the reason, by the marketplace.
      const customer = await ctx
        .http()
        .get(`${API}/orders/${o.order.id}`)
        .set(bearer(o.buyer.token))
        .expect(200);
      const vendor = await ctx
        .http()
        .get(`${API}/vendors/me/orders/${o.subId}`)
        .set(bearer(o.s.token))
        .expect(200);
      for (const view of [customer.body.subOrders[0], vendor.body]) {
        expect(view.reason).toBe('Shop unreachable');
        expect(view.history[view.history.length - 1].actor).toBe('MARKETPLACE');
        expect(JSON.stringify(view)).not.toContain(admin.id);
      }
    }
  });

  it('refuses DELIVERED, REJECTED and CANCELLED (scenario 4)', async () => {
    const delivered = await ordered();
    for (const action of ['confirm', 'dispatch', 'deliver']) {
      await vendorAct(delivered.s.token, delivered.subId, action).expect(200);
    }
    const rejected = await ordered();
    await ctx
      .http()
      .post(`${API}/vendors/me/orders/${rejected.subId}/reject`)
      .set(bearer(rejected.s.token))
      .send({ reason: 'No' })
      .expect(200);
    const cancelled = await ordered();
    await adminCancel(cancelled.order.id, cancelled.subId, { reason: 'Once' }).expect(200);

    for (const [o, status] of [
      [delivered, 'DELIVERED'],
      [rejected, 'REJECTED'],
      [cancelled, 'CANCELLED'],
    ] as const) {
      const res = await adminCancel(o.order.id, o.subId, { reason: 'Again' }).expect(409);
      expect(res.body.message).toBe(`Cannot cancel an order that is ${status}`);
    }
    // A sub-order under the wrong order is not found.
    await adminCancel(delivered.order.id, rejected.subId, { reason: 'x' }).expect(404);
  });

  it('denies customers and vendors (403) and anonymous users (401) (scenario 5)', async () => {
    const { s, buyer, order, subId } = await ordered();
    const customer = await registerUser(ctx);
    for (const token of [customer.accessToken, buyer.token, s.token]) {
      await ctx.http().get(ADMIN_ORDERS).set(bearer(token)).expect(403);
      await ctx.http().get(`${ADMIN_ORDERS}/${order.id}`).set(bearer(token)).expect(403);
      await ctx
        .http()
        .post(`${ADMIN_ORDERS}/${order.id}/sub-orders/${subId}/cancel`)
        .set(bearer(token))
        .send({ reason: 'x' })
        .expect(403);
    }
    await ctx.http().get(ADMIN_ORDERS).expect(401);
  });
});
