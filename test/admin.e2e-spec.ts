import {
  API,
  bearer,
  createApp,
  loginAdmin,
  PASSWORD,
  registerUser,
  resetUsers,
  TestContext,
  uniqueEmail,
} from './utils';

describe('Admin user management (US3)', () => {
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

  it('forbids customers from admin routes', async () => {
    const c = await registerUser(ctx);
    const res = await ctx.http().get(`${API}/admin/users`).set(bearer(c.accessToken)).expect(403);
    expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
    await ctx
      .http()
      .patch(`${API}/admin/users/${c.id}/status`)
      .set(bearer(c.accessToken))
      .send({ isActive: false })
      .expect(403);
  });

  it('lists users with pagination, filters and search', async () => {
    const email = uniqueEmail();
    const target = await registerUser(ctx, { fullName: 'Mwanaisha Bakari', email });
    await registerUser(ctx);
    await registerUser(ctx);

    const page = await ctx
      .http()
      .get(`${API}/admin/users?page=1&limit=2`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(page.body).toMatchObject({ page: 1, limit: 2, total: expect.any(Number) });
    expect(page.body.items).toHaveLength(2);
    expect(page.body.totalPages).toBe(Math.ceil(page.body.total / 2));

    const byName = await ctx
      .http()
      .get(`${API}/admin/users?search=mwanaisha`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(byName.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);

    const localPhone = `0${target.phone!.slice(4)}`;
    const byPhone = await ctx
      .http()
      .get(`${API}/admin/users?search=${localPhone}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(byPhone.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);

    const byEmail = await ctx
      .http()
      .get(`${API}/admin/users?search=${encodeURIComponent(email.toUpperCase())}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(byEmail.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);

    const admins = await ctx
      .http()
      .get(`${API}/admin/users?role=ADMIN`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(admins.body.items.every((u: { role: string }) => u.role === 'ADMIN')).toBe(true);

    await ctx.http().get(`${API}/admin/users?limit=101`).set(bearer(admin.accessToken)).expect(400);
  });

  it('gets a user by id; 404 for unknown', async () => {
    const c = await registerUser(ctx);
    const res = await ctx
      .http()
      .get(`${API}/admin/users/${c.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({ id: c.id, role: 'CUSTOMER' });
    await ctx
      .http()
      .get(`${API}/admin/users/00000000-0000-4000-8000-000000000000`)
      .set(bearer(admin.accessToken))
      .expect(404);
  });

  it('deactivation blocks the user immediately; reactivation restores sign-in', async () => {
    const c = await registerUser(ctx);

    const res = await ctx
      .http()
      .patch(`${API}/admin/users/${c.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false })
      .expect(200);
    expect(res.body.isActive).toBe(false);

    // still-valid access token is refused on the next request
    const me = await ctx.http().get(`${API}/users/me`).set(bearer(c.accessToken)).expect(403);
    expect(me.body.message).toBe('Account deactivated');
    // refresh refused (sessions revoked)
    await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken: c.refreshToken }).expect(401);
    // sign-in refused with a clear message
    const login = await ctx
      .http()
      .post(`${API}/auth/login`)
      .send({ identifier: c.phone, password: PASSWORD })
      .expect(403);
    expect(login.body.message).toBe('Account deactivated');

    await ctx
      .http()
      .patch(`${API}/admin/users/${c.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ isActive: true })
      .expect(200);
    // the old session stays revoked; a new sign-in is required
    await ctx.http().get(`${API}/users/me`).set(bearer(c.accessToken)).expect(401);
    await ctx
      .http()
      .post(`${API}/auth/login`)
      .send({ identifier: c.phone, password: PASSWORD })
      .expect(200);
  });

  it('refuses to change own status', async () => {
    const res = await ctx
      .http()
      .patch(`${API}/admin/users/${admin.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false })
      .expect(400);
    expect(res.body.message).toBe('You cannot change the status of your own account');
  });
});
