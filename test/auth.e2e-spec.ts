import {
  API,
  bearer,
  createApp,
  PASSWORD,
  registerUser,
  resetUsers,
  TestContext,
  uniqueEmail,
  uniquePhone,
} from './utils';

describe('Auth (US1)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('register', () => {
    it('creates a CUSTOMER with a normalised phone and returns a session', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ fullName: '  Juma Hamisi ', phone: '0712 345 678', password: PASSWORD })
        .expect(201);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: 900,
        user: {
          fullName: 'Juma Hamisi',
          phone: '+255712345678',
          email: null,
          role: 'CUSTOMER',
          isActive: true,
        },
      });
      expect(res.body.user.passwordHash).toBeUndefined();
      const stored = await ctx.prisma.user.findUnique({ where: { phone: '+255712345678' } });
      expect(stored?.passwordHash).not.toBe(PASSWORD);
    });

    it('rejects a duplicate phone in any format with 409', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ fullName: 'Other', phone: '+255712345678', password: PASSWORD })
        .expect(409);
      expect(res.body.message).toBe('Phone number is already registered');
    });

    it('treats emails case-insensitively', async () => {
      await registerUser(ctx, { email: 'Mama.Neema@Mail.com' });
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ fullName: 'Neema', email: 'mama.neema@mail.com', password: PASSWORD })
        .expect(409);
      expect(res.body.message).toBe('Email is already registered');
    });

    it('requires phone or email', async () => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ fullName: 'Nobody', password: PASSWORD })
        .expect(400);
      expect(res.body.message).toBe('Provide at least one of phone or email');
    });

    it.each([
      ['non-TZ phone', { phone: '+254712345678' }, 'phone'],
      ['invalid email', { email: 'not-an-email' }, 'email'],
      ['short password', { password: 'abc12' }, 'password'],
      ['password without digit', { password: 'abcdefghij' }, 'digit'],
      ['password without letter', { password: '1234567890' }, 'letter'],
    ])('rejects %s', async (_l, override, expected) => {
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ fullName: 'Test', phone: uniquePhone(), password: PASSWORD, ...override })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain(expected);
    });

    it('cannot self-assign a role', async () => {
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ fullName: 'Hacker', phone: uniquePhone(), password: PASSWORD, role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('login', () => {
    it('signs in with phone (any format) and with email', async () => {
      const email = uniqueEmail();
      const u = await registerUser(ctx, { phone: '0713000123', email });
      for (const identifier of ['0713000123', '+255 713 000 123', email.toUpperCase()]) {
        const res = await ctx
          .http()
          .post(`${API}/auth/login`)
          .send({ identifier, password: PASSWORD })
          .expect(200);
        expect(res.body.user.id).toBe(u.id);
      }
    });

    it('returns a generic error for wrong password and unknown account', async () => {
      const u = await registerUser(ctx);
      const wrong = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: u.phone, password: 'Wrong1234' })
        .expect(401);
      const unknown = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: 'ghost@example.co.tz', password: 'Wrong1234' })
        .expect(401);
      expect(wrong.body.message).toBe('Invalid credentials');
      expect(unknown.body.message).toBe('Invalid credentials');
    });
  });

  describe('me', () => {
    it('returns the signed-in user and rejects bad tokens', async () => {
      const u = await registerUser(ctx);
      const res = await ctx.http().get(`${API}/auth/me`).set(bearer(u.accessToken)).expect(200);
      expect(res.body).toMatchObject({ id: u.id, role: 'CUSTOMER' });
      await ctx.http().get(`${API}/auth/me`).set(bearer('garbage')).expect(401);
    });
  });

  describe('refresh', () => {
    it('rotates tokens: new pair works, old token stops working', async () => {
      const u = await registerUser(ctx);
      const res = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: u.refreshToken })
        .expect(200);
      expect(res.body.refreshToken).not.toBe(u.refreshToken);
      await ctx.http().get(`${API}/auth/me`).set(bearer(res.body.accessToken)).expect(200);
      // the previous access token still works, so in-flight requests survive a refresh
      await ctx.http().get(`${API}/auth/me`).set(bearer(u.accessToken)).expect(200);
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: res.body.refreshToken })
        .expect(200);
    });

    it('replay of a spent token → 401 and revokes all sessions of the user', async () => {
      const u = await registerUser(ctx);
      const rotated = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: u.refreshToken })
        .expect(200);
      // attacker replays the original token
      const replay = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: u.refreshToken })
        .expect(401);
      expect(replay.body.message).toBe('Invalid or expired refresh token');
      // the legitimate, newer token is now revoked too
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
      const live = await ctx.prisma.session.count({ where: { userId: u.id, revokedAt: null } });
      expect(live).toBe(0);
      // access tokens already issued stop working as well
      for (const token of [u.accessToken, rotated.body.accessToken]) {
        await ctx.http().get(`${API}/auth/me`).set(bearer(token)).expect(401);
      }
    });

    it('rejects malformed, forged and expired tokens', async () => {
      const u = await registerUser(ctx);
      await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken: 'nope' }).expect(401);
      const [sid] = u.refreshToken.split('.');
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: `${sid}.forgedsecretforgedsecretforged` })
        .expect(401);
      await ctx.prisma.session.update({ where: { id: sid }, data: { expiresAt: new Date(0) } });
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: u.refreshToken })
        .expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the refresh and access tokens and is idempotent', async () => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .post(`${API}/auth/logout`)
        .send({ refreshToken: u.refreshToken })
        .expect(204);
      await ctx.http().get(`${API}/auth/me`).set(bearer(u.accessToken)).expect(401);
      await ctx
        .http()
        .post(`${API}/auth/logout`)
        .send({ refreshToken: u.refreshToken })
        .expect(204);
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: u.refreshToken })
        .expect(401);
    });
  });

  describe('change password', () => {
    it('requires the current password, then signs out other sessions', async () => {
      const u = await registerUser(ctx);
      const other = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: u.phone, password: PASSWORD })
        .expect(200);

      await ctx
        .http()
        .post(`${API}/auth/change-password`)
        .set(bearer(u.accessToken))
        .send({ currentPassword: 'Wrong1234', newPassword: 'NewPass456' })
        .expect(400);

      await ctx
        .http()
        .post(`${API}/auth/change-password`)
        .set(bearer(u.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'NewPass456' })
        .expect(204);

      await ctx.http().get(`${API}/auth/me`).set(bearer(u.accessToken)).expect(200);
      await ctx.http().get(`${API}/auth/me`).set(bearer(other.body.accessToken)).expect(401);

      // the current session survives and still refreshes; the other session is revoked
      // (checked second: presenting a revoked token triggers replay protection → revoke all)
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: u.refreshToken })
        .expect(200);
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: other.body.refreshToken })
        .expect(401);

      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: u.phone, password: PASSWORD })
        .expect(401);
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: u.phone, password: 'NewPass456' })
        .expect(200);
    });
  });
});

describe('Auth throttling (FR-019)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp({ authThrottleLimit: 3 });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('returns 429 after the limit of sign-in attempts per client', async () => {
    const attempt = () =>
      ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ identifier: 'ghost@example.co.tz', password: 'Wrong1234' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const res = await attempt().expect(429);
    expect(res.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
  });

  it('does not throttle other routes', async () => {
    for (let i = 0; i < 5; i++) await ctx.http().get(`${API}/regions`).expect(200);
  });
});
