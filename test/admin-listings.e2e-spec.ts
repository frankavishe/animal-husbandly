import {
  API,
  bearer,
  createApp,
  createListing,
  createVendor,
  loginAdmin,
  publishListing,
  registerUser,
  resetUsers,
  TestContext,
} from './utils';

const REASON = 'Photos do not match the animal';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Admin listing moderation (US5)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };
  let token: string;
  let vendorId: string;

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
    const { user, vendor } = await createVendor(ctx, admin.accessToken, {
      approve: true,
      overrides: { species: ['CATTLE', 'CHICKEN'] },
    });
    token = user.accessToken;
    vendorId = vendor.id;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const list = (query: object = {}) =>
    ctx.http().get(`${API}/admin/listings`).query(query).set(bearer(admin.accessToken));
  const get = (id: string) =>
    ctx.http().get(`${API}/admin/listings/${id}`).set(bearer(admin.accessToken));
  const takeDown = (id: string, body: object = { reason: REASON }) =>
    ctx
      .http()
      .post(`${API}/admin/listings/${id}/take-down`)
      .set(bearer(admin.accessToken))
      .send(body);
  const restore = (id: string) =>
    ctx.http().post(`${API}/admin/listings/${id}/restore`).set(bearer(admin.accessToken));
  const vendorAction = (id: string, name: string) =>
    ctx.http().post(`${API}/vendors/me/listings/${id}/${name}`).set(bearer(token));
  const vendorGet = (id: string) =>
    ctx.http().get(`${API}/vendors/me/listings/${id}`).set(bearer(token));
  const publicGet = (id: string) => ctx.http().get(`${API}/listings/${id}`);
  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((l) => l.id);

  it('denies customers, vendors and anonymous callers every operation (scenario 6)', async () => {
    const { id } = await createListing(ctx, token);
    const customer = await registerUser(ctx);
    const calls = [
      ['get', ''],
      ['get', `/${id}`],
      ['post', `/${id}/take-down`],
      ['post', `/${id}/restore`],
    ] as const;
    for (const [method, path] of calls) {
      const url = `${API}/admin/listings${path}`;
      await ctx.http()[method](url).expect(401);
      for (const t of [customer.accessToken, token]) {
        await ctx.http()[method](url).set(bearer(t)).expect(403);
      }
    }
    expect((await vendorGet(id).expect(200)).body.status).toBe('DRAFT');
  });

  it('lists every status with filters and pagination, newest first (scenario 1)', async () => {
    const other = await createVendor(ctx, admin.accessToken, {
      approve: true,
      overrides: { species: ['CATTLE', 'CHICKEN'] },
    });
    const t = other.user.accessToken;
    const shop = other.vendor.id;
    const draft = await createListing(ctx, t);
    const eggs = await createListing(ctx, t, {
      title: 'Kienyeji eggs',
      species: 'CHICKEN',
      listingType: 'EGGS',
      unit: 'TRAY',
      breed: undefined,
      sex: undefined,
      ageMonths: undefined,
    });
    await publishListing(ctx, t, eggs.id);
    const archived = await createListing(ctx, t);
    await ctx
      .http()
      .post(`${API}/vendors/me/listings/${archived.id}/archive`)
      .set(bearer(t))
      .expect(200);
    const down = await createListing(ctx, t);
    await takeDown(down.id).expect(200);

    const all = await list({ vendorId: shop }).expect(200);
    expect(ids(all)).toEqual([down.id, archived.id, eggs.id, draft.id]);
    expect(ids(await list({ vendorId: shop, status: 'ARCHIVED' }))).toEqual([archived.id]);
    expect(ids(await list({ vendorId: shop, status: 'TAKEN_DOWN' }))).toEqual([down.id]);
    expect(ids(await list({ vendorId: shop, species: 'CHICKEN' }))).toEqual([eggs.id]);
    expect(ids(await list({ vendorId: shop, listingType: 'EGGS' }))).toEqual([eggs.id]);

    const page2 = await list({ vendorId: shop, limit: 3, page: 2 }).expect(200);
    expect(page2.body).toMatchObject({ page: 2, limit: 3, total: 4, totalPages: 2 });
    expect(ids(page2)).toEqual([draft.id]);

    const unfiltered = await list({ limit: 100 }).expect(200);
    expect(unfiltered.body.total).toBeGreaterThan(4);
  });

  it('rejects bad filters and ids', async () => {
    await list({ status: 'GONE' }).expect(400);
    await list({ vendorId: 'abc' }).expect(400);
    await list({ species: 'DOG' }).expect(400);
    await list({ limit: 101 }).expect(400);
    await get('abc').expect(400);
    await get(UNKNOWN).expect(404);
    await takeDown(UNKNOWN).expect(404);
    await restore(UNKNOWN).expect(404);
  });

  it('take-down needs a reason of 1–500 characters (scenario 3)', async () => {
    const { id } = await createListing(ctx, token);
    const cases: [object, string][] = [
      [{}, 'reason is required'],
      [{ reason: null }, 'reason is required'],
      [{ reason: '   ' }, 'reason is required'],
      [{ reason: 5 }, 'reason must be a string'],
      [{ reason: 'x'.repeat(501) }, 'reason must be at most 500 characters'],
    ];
    for (const [body, message] of cases) {
      const res = await takeDown(id, body).expect(400);
      expect(res.body.message).toEqual([message]);
    }
    await takeDown(id, { reason: REASON, status: 'ACTIVE' }).expect(400);
    expect((await get(id).expect(200)).body.status).toBe('DRAFT');
  });

  it('takes down, records the audit, hides publicly, and restores (scenarios 2–5)', async () => {
    const { id } = await createListing(ctx, token);
    const { publishedAt } = await publishListing(ctx, token, id);
    await publicGet(id).expect(200);

    const down = await takeDown(id).expect(200);
    expect(down.body).toMatchObject({
      id,
      status: 'TAKEN_DOWN',
      takenDownReason: REASON,
      takenDownAt: expect.any(String),
      takenDownBy: { id: admin.id, fullName: expect.any(String) },
      vendor: { id: vendorId, status: 'APPROVED' },
    });
    expect((await get(id).expect(200)).body).toEqual(down.body);
    await publicGet(id).expect(404);

    const mine = await vendorGet(id).expect(200);
    expect(mine.body).toMatchObject({ status: 'TAKEN_DOWN', takenDownReason: REASON });
    expect(mine.body).not.toHaveProperty('takenDownBy');
    for (const name of ['publish', 'activate', 'pause']) {
      const res = await vendorAction(id, name).expect(409);
      expect(res.body.message).toBe(`Cannot ${name} a listing that is TAKEN_DOWN`);
    }
    const again = await takeDown(id).expect(409);
    expect(again.body.message).toBe('Cannot take down a listing that is TAKEN_DOWN');

    const restored = await restore(id).expect(200);
    expect(restored.body).toMatchObject({
      status: 'INACTIVE',
      takenDownReason: null,
      takenDownAt: down.body.takenDownAt,
      takenDownBy: { id: admin.id },
    });
    expect((await restore(id).expect(409)).body.message).toBe(
      'Cannot restore a listing that is INACTIVE',
    );
    await publicGet(id).expect(404);

    const active = await vendorAction(id, 'activate').expect(200);
    expect(active.body).toMatchObject({ status: 'ACTIVE', publishedAt });
    await publicGet(id).expect(200);
  });

  it('a taken-down listing can still be edited and archived by its vendor', async () => {
    const { id } = await createListing(ctx, token);
    await takeDown(id).expect(200);
    const edited = await ctx
      .http()
      .patch(`${API}/vendors/me/listings/${id}`)
      .set(bearer(token))
      .send({ title: 'Corrected title' })
      .expect(200);
    expect(edited.body).toMatchObject({ title: 'Corrected title', status: 'TAKEN_DOWN' });
    await vendorAction(id, 'archive').expect(200);
    expect((await takeDown(id).expect(409)).body.message).toBe(
      'Cannot take down a listing that is ARCHIVED',
    );
    await restore(id).expect(409);
  });

  it('a draft restored before ever being published gets publishedAt on activate', async () => {
    const { id } = await createListing(ctx, token);
    await takeDown(id).expect(200);
    await restore(id).expect(200);
    const active = await vendorAction(id, 'activate').expect(200);
    expect(active.body.publishedAt).toEqual(expect.any(String));

    const newer = await createListing(ctx, token);
    await publishListing(ctx, token, newer.id);
    const res = await ctx.http().get(`${API}/listings`).expect(200);
    expect(ids(res).slice(0, 2)).toEqual([newer.id, id]);
  });

  it('concurrent take-downs: exactly one succeeds', async () => {
    const { id } = await createListing(ctx, token);
    const results = await Promise.all([takeDown(id), takeDown(id), takeDown(id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
});
