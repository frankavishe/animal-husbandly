import {
  API,
  bearer,
  createApp,
  registerUser,
  RegisteredUser,
  resetUsers,
  TestContext,
  uniqueEmail,
} from './utils';

describe('Users, regions & addresses (US2)', () => {
  let ctx: TestContext;
  let dar: { id: number };
  let ilala: { id: number };
  let arushaDistrict: { id: number };

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    dar = await ctx.prisma.region.findUniqueOrThrow({ where: { code: 'TZ-02' } });
    ilala = await ctx.prisma.district.findFirstOrThrow({
      where: { regionId: dar.id, name: 'Ilala' },
    });
    arushaDistrict = await ctx.prisma.district.findFirstOrThrow({
      where: { region: { code: 'TZ-01' } },
    });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('profile', () => {
    it('GET /users/me returns my profile', async () => {
      const u = await registerUser(ctx);
      const res = await ctx.http().get(`${API}/users/me`).set(bearer(u.accessToken)).expect(200);
      expect(res.body).toEqual({
        id: u.id,
        fullName: 'Test User',
        phone: u.phone,
        email: null,
        role: 'CUSTOMER',
        isActive: true,
        createdAt: expect.any(String),
      });
    });

    it('PATCH /users/me updates name/email and can clear phone once email exists', async () => {
      const u = await registerUser(ctx);
      const email = uniqueEmail();
      const res = await ctx
        .http()
        .patch(`${API}/users/me`)
        .set(bearer(u.accessToken))
        .send({ fullName: 'Neema Juma', email: email.toUpperCase() })
        .expect(200);
      expect(res.body).toMatchObject({ fullName: 'Neema Juma', email, phone: u.phone });

      const cleared = await ctx
        .http()
        .patch(`${API}/users/me`)
        .set(bearer(u.accessToken))
        .send({ phone: null })
        .expect(200);
      expect(cleared.body.phone).toBeNull();

      const res2 = await ctx
        .http()
        .patch(`${API}/users/me`)
        .set(bearer(u.accessToken))
        .send({ email: null })
        .expect(400);
      expect(res2.body.message).toBe('At least one of phone or email must remain on the account');
    });

    it('PATCH /users/me rejects identifiers used by someone else and cannot change role', async () => {
      const a = await registerUser(ctx);
      const b = await registerUser(ctx);
      await ctx
        .http()
        .patch(`${API}/users/me`)
        .set(bearer(b.accessToken))
        .send({ phone: a.phone })
        .expect(409);
      await ctx
        .http()
        .patch(`${API}/users/me`)
        .set(bearer(b.accessToken))
        .send({ role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('regions', () => {
    it('lists all 31 regions publicly', async () => {
      const res = await ctx.http().get(`${API}/regions`).expect(200);
      expect(res.body).toHaveLength(31);
      expect(res.body[0]).toEqual({
        id: expect.any(Number),
        name: expect.any(String),
        code: expect.any(String),
      });
    });

    it('lists districts of a region; 404 for unknown, 400 for non-numeric', async () => {
      const res = await ctx.http().get(`${API}/regions/${dar.id}/districts`).expect(200);
      expect(res.body.map((d: { name: string }) => d.name)).toEqual(
        expect.arrayContaining(['Ilala', 'Kinondoni', 'Temeke', 'Ubungo', 'Kigamboni']),
      );
      await ctx.http().get(`${API}/regions/99999/districts`).expect(404);
      await ctx.http().get(`${API}/regions/abc/districts`).expect(400);
    });
  });

  describe('addresses', () => {
    let u: RegisteredUser;
    const base = () => ({
      label: 'Home',
      recipientName: 'Juma Hamisi',
      contactPhone: '0712 000 111',
      regionId: dar.id,
      districtId: ilala.id,
      wardStreet: 'Kariakoo, Mtaa wa Congo',
    });
    const create = (body: object, token = u.accessToken) =>
      ctx.http().post(`${API}/users/me/addresses`).set(bearer(token)).send(body);

    beforeAll(async () => {
      u = await registerUser(ctx);
    });

    it('rejects a district outside the region', async () => {
      const res = await create({ ...base(), districtId: arushaDistrict.id }).expect(400);
      expect(res.body.message).toBe('District does not belong to the selected region');
    });

    it('first address becomes default; second marked default takes over; list default first', async () => {
      const first = await create(base()).expect(201);
      expect(first.body).toMatchObject({
        isDefault: true,
        contactPhone: '+255712000111',
        region: { id: dar.id, name: 'Dar es Salaam' },
        district: { id: ilala.id, name: 'Ilala' },
        landmark: null,
      });

      const second = await create({ ...base(), label: 'Shop', isDefault: true }).expect(201);
      expect(second.body.isDefault).toBe(true);

      const list = await ctx
        .http()
        .get(`${API}/users/me/addresses`)
        .set(bearer(u.accessToken))
        .expect(200);
      expect(list.body).toHaveLength(2);
      expect(list.body[0]).toMatchObject({ id: second.body.id, isDefault: true });
      expect(list.body[1]).toMatchObject({ id: first.body.id, isDefault: false });
    });

    it('updates an address and switches default via PATCH', async () => {
      const list = await ctx
        .http()
        .get(`${API}/users/me/addresses`)
        .set(bearer(u.accessToken))
        .expect(200);
      const nonDefault = list.body.find((a: { isDefault: boolean }) => !a.isDefault);
      const res = await ctx
        .http()
        .patch(`${API}/users/me/addresses/${nonDefault.id}`)
        .set(bearer(u.accessToken))
        .send({ landmark: 'Near the mosque', isDefault: true })
        .expect(200);
      expect(res.body).toMatchObject({ landmark: 'Near the mosque', isDefault: true });
      const defaults = await ctx.prisma.address.count({ where: { userId: u.id, isDefault: true } });
      expect(defaults).toBe(1);

      await ctx
        .http()
        .patch(`${API}/users/me/addresses/${nonDefault.id}`)
        .set(bearer(u.accessToken))
        .send({ isDefault: false })
        .expect(400);
    });

    it('deleting the default promotes the most recently created remaining address', async () => {
      const third = await create({ ...base(), label: 'Farm' }).expect(201);
      const current = await ctx.prisma.address.findFirstOrThrow({
        where: { userId: u.id, isDefault: true },
      });
      await ctx
        .http()
        .delete(`${API}/users/me/addresses/${current.id}`)
        .set(bearer(u.accessToken))
        .expect(204);
      const promoted = await ctx.prisma.address.findFirstOrThrow({
        where: { userId: u.id, isDefault: true },
      });
      expect(promoted.id).toBe(third.body.id);
    });

    it("another user's address is not found", async () => {
      const other = await registerUser(ctx);
      const mine = await create(base()).expect(201);
      for (const req of [
        ctx.http().get(`${API}/users/me/addresses/${mine.body.id}`),
        ctx.http().patch(`${API}/users/me/addresses/${mine.body.id}`).send({ label: 'X' }),
        ctx.http().delete(`${API}/users/me/addresses/${mine.body.id}`),
      ]) {
        await req.set(bearer(other.accessToken)).expect(404);
      }
      await ctx
        .http()
        .get(`${API}/users/me/addresses/not-a-uuid`)
        .set(bearer(u.accessToken))
        .expect(400);
    });
  });
});
