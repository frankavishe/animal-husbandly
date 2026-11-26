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

const VENDOR_ORDERS = `${API}/vendors/me/orders`;

describe('Vendor orders (US3)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };

  const shop = (overrides = {}) => shopWithListing(ctx, admin.accessToken, overrides);
  const act = (token: string, id: string, action: string, body?: object) => {
    const req = ctx.http().post(`${VENDOR_ORDERS}/${id}/${action}`).set(bearer(token));
    return body ? req.send(body) : req;
  };
  const listingStatus = async (id: string) =>
    (await ctx.prisma.listing.findUniqueOrThrow({ where: { id } })).status;

  /** A shop, a buyer and one placed order of `quantity` of the shop's listing. */
  async function ordered(quantity = 2, overrides = {}) {
    const s = await shop(overrides);
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

  it('confirms, dispatches and delivers, recording each step and the cash (scenario 1)', async () => {
    const { s, buyer, order, subId } = await ordered();
    let res = await act(s.token, subId, 'confirm').expect(200);
    expect(res.body.status).toBe('CONFIRMED');
    res = await act(s.token, subId, 'dispatch').expect(200);
    expect(res.body.status).toBe('DISPATCHED');
    expect(res.body.cashCollectedAt).toBeNull();
    res = await act(s.token, subId, 'deliver').expect(200);
    expect(res.body.status).toBe('DELIVERED');
    expect(res.body.cashCollectedAt).toEqual(expect.any(String));
    expect(res.body.history.map((h: any) => [h.fromStatus, h.toStatus, h.actor, h.reason])).toEqual(
      [
        [null, 'PENDING', 'CUSTOMER', null],
        ['PENDING', 'CONFIRMED', 'VENDOR', null],
        ['CONFIRMED', 'DISPATCHED', 'VENDOR', null],
        ['DISPATCHED', 'DELIVERED', 'VENDOR', null],
      ],
    );
    const rows = await ctx.prisma.subOrderStatusHistory.findMany({
      where: { subOrderId: subId, actorType: 'VENDOR' },
    });
    expect(rows.every((r) => r.actorId === s.userId)).toBe(true);

    const customer = await ctx
      .http()
      .get(`${API}/orders/${order.id}`)
      .set(bearer(buyer.token))
      .expect(200);
    expect(customer.body.status).toBe('COMPLETED');
    expect(await getStock(ctx, s.listingId)).toBe(8);
  });

  it('rejects with a valid reason only; the customer sees it and stock returns (scenario 2)', async () => {
    const { s, buyer, order, subId } = await ordered(3);
    expect(await getStock(ctx, s.listingId)).toBe(7);
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(501) }]) {
      await act(s.token, subId, 'reject', body).expect(400);
    }
    const res = await act(s.token, subId, 'reject', { reason: '  Out of feed  ' }).expect(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', reason: 'Out of feed' });
    expect(await getStock(ctx, s.listingId)).toBe(10);

    const customer = await ctx
      .http()
      .get(`${API}/orders/${order.id}`)
      .set(bearer(buyer.token))
      .expect(200);
    expect(customer.body.status).toBe('CANCELLED');
    expect(customer.body.subOrders[0]).toMatchObject({ status: 'REJECTED', reason: 'Out of feed' });
  });

  it('refuses actions not allowed from the current status (scenario 3)', async () => {
    const { s, subId } = await ordered();
    let res = await act(s.token, subId, 'deliver').expect(409);
    expect(res.body.message).toBe('Cannot deliver an order that is PENDING');
    await act(s.token, subId, 'dispatch').expect(409);
    await act(s.token, subId, 'cancel', { reason: 'x' }).expect(409);
    await act(s.token, subId, 'confirm').expect(200);
    res = await act(s.token, subId, 'reject', { reason: 'x' }).expect(409);
    expect(res.body.message).toBe('Cannot reject an order that is CONFIRMED');
    await act(s.token, subId, 'confirm').expect(409);
  });

  it('shows only the own part, delivery details and nothing else (scenario 4)', async () => {
    const a = await shop({ unitPrice: 1000 });
    const b = await shop({ unitPrice: 2000, title: 'Other shop item' });
    const buyer = await buyerWithAddress(ctx);
    const order = await placeOrder(ctx, buyer.token, buyer.addressId, [
      { listingId: a.listingId },
      { listingId: b.listingId },
    ]);
    const mine = order.subOrders.find((x: any) => x.items[0].listingId === a.listingId);

    const res = await ctx
      .http()
      .get(`${VENDOR_ORDERS}/${mine.id}`)
      .set(bearer(a.token))
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'cashCollectedAt',
      'createdAt',
      'deliveryAddress',
      'history',
      'id',
      'items',
      'orderNumber',
      'paymentMethod',
      'reason',
      'shopName',
      'status',
      'subtotal',
      'updatedAt',
    ]);
    expect(res.body).toMatchObject({
      orderNumber: order.orderNumber,
      subtotal: 1000,
      deliveryAddress: order.deliveryAddress,
      items: [{ listingId: a.listingId, unitPrice: 1000, quantity: 1 }],
    });
    const json = JSON.stringify(res.body);
    for (const hidden of [b.listingId, 'Other shop item', buyer.id, buyer.phone, order.id]) {
      expect(json).not.toContain(hidden);
    }
    expect(json).not.toContain('"total"');
  });

  it("404s for another shop's sub-order (scenario 5)", async () => {
    const { subId } = await ordered();
    const other = await shop();
    const res = await ctx
      .http()
      .get(`${VENDOR_ORDERS}/${subId}`)
      .set(bearer(other.token))
      .expect(404);
    expect(res.body.message).toBe('Order not found');
    for (const action of ['confirm', 'dispatch', 'deliver']) {
      await act(other.token, subId, action).expect(404);
    }
    await act(other.token, subId, 'reject', { reason: 'x' }).expect(404);
    await act(other.token, subId, 'cancel', { reason: 'x' }).expect(404);
  });

  it('keeps working for a suspended shop (scenario 6)', async () => {
    const one = await ordered();
    const two = await ordered();
    for (const o of [one, two]) {
      await ctx
        .http()
        .post(`${API}/admin/vendors/${o.s.vendor.id}/suspend`)
        .set(bearer(admin.accessToken))
        .expect(200);
    }
    await ctx.http().get(VENDOR_ORDERS).set(bearer(one.s.token)).expect(200);
    await act(one.s.token, one.subId, 'confirm').expect(200);
    await act(one.s.token, one.subId, 'cancel', { reason: 'Shop closed' }).expect(200);
    await act(two.s.token, two.subId, 'reject', { reason: 'Shop closed' }).expect(200);
    expect(await getStock(ctx, one.s.listingId)).toBe(10);
  });

  it('lists by status, newest first, paginated (scenario 7)', async () => {
    const s = await shop({ stockQuantity: 50 });
    const buyer = await buyerWithAddress(ctx);
    const subIds: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const o = await placeOrder(ctx, buyer.token, buyer.addressId, [{ listingId: s.listingId }]);
      subIds.push(o.subOrders[0].id);
    }
    await act(s.token, subIds[1], 'confirm').expect(200);
    await act(s.token, subIds[2], 'reject', { reason: 'No' }).expect(200);

    const all = await ctx.http().get(VENDOR_ORDERS).set(bearer(s.token)).expect(200);
    expect(all.body).toMatchObject({ page: 1, limit: 20, total: 4, totalPages: 1 });
    expect(all.body.items.map((x: any) => x.id)).toEqual([...subIds].reverse());

    const pending = await ctx
      .http()
      .get(`${VENDOR_ORDERS}?status=PENDING&limit=1`)
      .set(bearer(s.token))
      .expect(200);
    expect(pending.body).toMatchObject({ total: 2, totalPages: 2, limit: 1 });
    expect(pending.body.items.map((x: any) => x.id)).toEqual([subIds[3]]);
    const page2 = await ctx
      .http()
      .get(`${VENDOR_ORDERS}?status=PENDING&limit=1&page=2`)
      .set(bearer(s.token))
      .expect(200);
    expect(page2.body.items.map((x: any) => x.id)).toEqual([subIds[0]]);

    const confirmed = await ctx
      .http()
      .get(`${VENDOR_ORDERS}?status=CONFIRMED`)
      .set(bearer(s.token))
      .expect(200);
    expect(confirmed.body.items.map((x: any) => x.id)).toEqual([subIds[1]]);
    await ctx.http().get(`${VENDOR_ORDERS}?status=OPEN`).set(bearer(s.token)).expect(400);
    await ctx.http().get(`${VENDOR_ORDERS}?limit=101`).set(bearer(s.token)).expect(400);
  });

  it('cancels CONFIRMED with a reason only; stock returns; the customer sees why (scenario 8)', async () => {
    const { s, buyer, order, subId } = await ordered(4);
    await act(s.token, subId, 'confirm').expect(200);
    await act(s.token, subId, 'cancel', {}).expect(400);
    await act(s.token, subId, 'cancel', { reason: 'y'.repeat(501) }).expect(400);
    const res = await act(s.token, subId, 'cancel', { reason: 'Animal fell sick' }).expect(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', reason: 'Animal fell sick' });
    expect(await getStock(ctx, s.listingId)).toBe(10);
    const customer = await ctx
      .http()
      .get(`${API}/orders/${order.id}`)
      .set(bearer(buyer.token))
      .expect(200);
    expect(customer.body.subOrders[0].reason).toBe('Animal fell sick');
  });

  it('refuses to cancel a DISPATCHED sub-order (scenario 9)', async () => {
    const { s, subId } = await ordered();
    await act(s.token, subId, 'confirm').expect(200);
    await act(s.token, subId, 'dispatch').expect(200);
    const res = await act(s.token, subId, 'cancel', { reason: 'Too late' }).expect(409);
    expect(res.body.message).toBe('Cannot cancel an order that is DISPATCHED');
    expect(await getStock(ctx, s.listingId)).toBe(8);
  });

  it('denies customers and admins (403) and anonymous users (401)', async () => {
    const { subId } = await ordered();
    const customer = await registerUser(ctx);
    for (const token of [customer.accessToken, admin.accessToken]) {
      await ctx.http().get(VENDOR_ORDERS).set(bearer(token)).expect(403);
      await act(token, subId, 'confirm').expect(403);
    }
    await ctx.http().get(VENDOR_ORDERS).expect(401);
    await ctx.http().get(`${VENDOR_ORDERS}/not-a-uuid`).set(bearer(admin.accessToken)).expect(403);
  });

  it('returns stock to ARCHIVED, INACTIVE and TAKEN_DOWN listings without changing their status, capped', async () => {
    const archived = await ordered(2);
    const inactive = await ordered(2);
    const takenDown = await ordered(2);
    await ctx
      .http()
      .post(`${API}/vendors/me/listings/${archived.s.listingId}/archive`)
      .set(bearer(archived.s.token))
      .expect(200);
    await ctx
      .http()
      .post(`${API}/vendors/me/listings/${inactive.s.listingId}/pause`)
      .set(bearer(inactive.s.token))
      .expect(200);
    await ctx
      .http()
      .post(`${API}/admin/listings/${takenDown.s.listingId}/take-down`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'Wrong photos' })
      .expect(200);
    for (const o of [archived, inactive, takenDown]) {
      await act(o.s.token, o.subId, 'reject', { reason: 'No' }).expect(200);
      expect(await getStock(ctx, o.s.listingId)).toBe(10);
    }
    expect(await listingStatus(archived.s.listingId)).toBe('ARCHIVED');
    expect(await listingStatus(inactive.s.listingId)).toBe('INACTIVE');
    expect(await listingStatus(takenDown.s.listingId)).toBe('TAKEN_DOWN');

    // Capped at 1,000,000.
    const big = await ordered(5, { stockQuantity: 1_000_000 });
    await ctx
      .http()
      .patch(`${API}/vendors/me/listings/${big.s.listingId}`)
      .set(bearer(big.s.token))
      .send({ stockQuantity: 999_998 })
      .expect(200);
    await act(big.s.token, big.subId, 'reject', { reason: 'No' }).expect(200);
    expect(await getStock(ctx, big.s.listingId)).toBe(1_000_000);
  });

  it('lets exactly one of a simultaneous confirm and reject succeed; stock returns at most once', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { s, subId } = await ordered(2);
      const [confirm, reject] = await Promise.all([
        act(s.token, subId, 'confirm'),
        act(s.token, subId, 'reject', { reason: 'Race' }),
      ]);
      expect([confirm.status, reject.status].sort()).toEqual([200, 409]);
      const history = await ctx.prisma.subOrderStatusHistory.count({
        where: { subOrderId: subId },
      });
      expect(history).toBe(2);
      expect(await getStock(ctx, s.listingId)).toBe(reject.status === 200 ? 10 : 8);
    }
  });

  it('gives a shop without orders an empty list', async () => {
    const s = await shop();
    const res = await ctx.http().get(VENDOR_ORDERS).set(bearer(s.token)).expect(200);
    expect(res.body).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});
