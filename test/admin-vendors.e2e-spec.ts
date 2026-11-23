import {
  API,
  bearer,
  createApp,
  createVendor,
  loginAdmin,
  registerUser,
  resetUsers,
  TestContext,
} from './utils';

describe('Admin vendor review (US2)', () => {
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

  const post = (path: string, body?: object) =>
    ctx.http().post(`${API}/admin/vendors/${path}`).set(bearer(admin.accessToken)).send(body);

  it('forbids customers and vendors', async () => {
    const c = await registerUser(ctx);
    await ctx.http().get(`${API}/admin/vendors`).set(bearer(c.accessToken)).expect(403);
    const { user, vendor } = await createVendor(ctx, admin.accessToken, { approve: true });
    await ctx.http().get(`${API}/admin/vendors`).set(bearer(user.accessToken)).expect(403);
    await ctx
      .http()
      .post(`${API}/admin/vendors/${vendor.id}/suspend`)
      .set(bearer(user.accessToken))
      .expect(403);
  });

  it('lists by status with pagination, newest submission first', async () => {
    const tag = `Adm${Date.now()}`;
    const a = await createVendor(ctx, admin.accessToken, { overrides: { shopName: `${tag} A` } });
    const b = await createVendor(ctx, admin.accessToken, { overrides: { shopName: `${tag} B` } });
    await createVendor(ctx, admin.accessToken, {
      approve: true,
      overrides: { shopName: `${tag} C` },
    });

    const res = await ctx
      .http()
      .get(`${API}/admin/vendors`)
      .query({ status: 'PENDING', search: tag, limit: 1 })
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({ total: 2, totalPages: 2, limit: 1 });
    expect(res.body.items[0].id).toBe(b.vendor.id);

    const page2 = await ctx
      .http()
      .get(`${API}/admin/vendors`)
      .query({ status: 'PENDING', search: tag, limit: 1, page: 2 })
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(page2.body.items[0].id).toBe(a.vendor.id);
  });

  it('reject → resubmit → approve makes the owner a VENDOR on the next request', async () => {
    const { user, vendor } = await createVendor(ctx, admin.accessToken);

    await post(`${vendor.id}/reject`, {}).expect(400);
    await post(`${vendor.id}/reject`, { reason: '   ' }).expect(400);
    const rejected = await post(`${vendor.id}/reject`, { reason: 'Phone unreachable' }).expect(200);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Phone unreachable',
      reviewedBy: { id: admin.id },
    });

    const mine = await ctx
      .http()
      .get(`${API}/vendors/me`)
      .set(bearer(user.accessToken))
      .expect(200);
    expect(mine.body.rejectionReason).toBe('Phone unreachable');

    await ctx
      .http()
      .patch(`${API}/vendors/me`)
      .set(bearer(user.accessToken))
      .send({ description: 'Fixed phone' })
      .expect(200);
    const resubmitted = await ctx
      .http()
      .post(`${API}/vendors/me/resubmit`)
      .set(bearer(user.accessToken))
      .expect(200);
    expect(resubmitted.body).toMatchObject({ status: 'PENDING', rejectionReason: null });

    const before = await ctx.http().get(`${API}/auth/me`).set(bearer(user.accessToken)).expect(200);
    expect(before.body.role).toBe('CUSTOMER');

    const approved = await post(`${vendor.id}/approve`).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', owner: { id: user.id } });

    // Same access token: the role is read from the database on every request (SC-002).
    const after = await ctx.http().get(`${API}/auth/me`).set(bearer(user.accessToken)).expect(200);
    expect(after.body.role).toBe('VENDOR');
    await ctx.http().get(`${API}/vendors/me`).set(bearer(user.accessToken)).expect(200);

    const twice = await post(`${vendor.id}/approve`).expect(409);
    expect(twice.body.message).toBe('Cannot approve a shop that is APPROVED');
  });

  it('suspends and reactivates; suspended shops cannot be edited', async () => {
    const { user, vendor } = await createVendor(ctx, admin.accessToken, { approve: true });
    await post(`${vendor.id}/suspend`).expect(200);
    const res = await ctx
      .http()
      .patch(`${API}/vendors/me`)
      .set(bearer(user.accessToken))
      .send({ description: 'x' })
      .expect(403);
    expect(res.body.message).toBe('Your shop is suspended');
    await ctx.http().get(`${API}/vendors/${vendor.slug}`).expect(404);

    const back = await post(`${vendor.id}/reactivate`).expect(200);
    expect(back.body.status).toBe('APPROVED');
    await ctx.http().get(`${API}/vendors/${vendor.slug}`).expect(200);
    await post(`${vendor.id}/reactivate`).expect(409);
  });

  it('refuses invalid transitions with the current status', async () => {
    const { vendor } = await createVendor(ctx, admin.accessToken);
    const s = await post(`${vendor.id}/suspend`).expect(409);
    expect(s.body.message).toBe('Cannot suspend a shop that is PENDING');
    await post(`${vendor.id}/reactivate`).expect(409);
  });

  it('refuses to approve a deactivated owner', async () => {
    const { user, vendor } = await createVendor(ctx, admin.accessToken);
    await ctx
      .http()
      .patch(`${API}/admin/users/${user.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false })
      .expect(200);
    const res = await post(`${vendor.id}/approve`).expect(409);
    expect(res.body.message).toBe('Owner account is deactivated');
    const detail = await ctx
      .http()
      .get(`${API}/admin/vendors/${vendor.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(detail.body.status).toBe('PENDING');
  });

  it('shows detail and validates ids', async () => {
    const { user, vendor } = await createVendor(ctx, admin.accessToken);
    const res = await ctx
      .http()
      .get(`${API}/admin/vendors/${vendor.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      id: vendor.id,
      owner: { id: user.id, isActive: true },
      reviewedBy: null,
      payoutAccount: null,
    });
    await ctx
      .http()
      .get(`${API}/admin/vendors/not-a-uuid`)
      .set(bearer(admin.accessToken))
      .expect(400);
    await ctx
      .http()
      .get(`${API}/admin/vendors/00000000-0000-4000-8000-000000000000`)
      .set(bearer(admin.accessToken))
      .expect(404);
  });
});
