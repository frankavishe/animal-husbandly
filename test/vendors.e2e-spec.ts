import {
  API,
  applyVendor,
  bearer,
  createApp,
  createVendor,
  loginAdmin,
  PNG,
  registerUser,
  resetUsers,
  TestContext,
  validVendorBody,
} from './utils';

describe('Vendors', () => {
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

  // ------------------------------------------------------------------------------ US1
  describe('owner (US1)', () => {
    it('applies, then refuses a second application', async () => {
      const u = await registerUser(ctx);
      const body = await validVendorBody(ctx.prisma, { shopName: "Ng'ombe Bora Mwanza" });
      const res = await ctx
        .http()
        .post(`${API}/vendors/me`)
        .set(bearer(u.accessToken))
        .send(body)
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        slug: 'ngombe-bora-mwanza',
        shopName: "Ng'ombe Bora Mwanza",
        businessPhone: expect.stringMatching(/^\+255\d{9}$/),
        species: ['CATTLE'],
        rejectionReason: null,
        payoutAccount: null,
        logoUrl: null,
      });

      const again = await ctx
        .http()
        .post(`${API}/vendors/me`)
        .set(bearer(u.accessToken))
        .send(await validVendorBody(ctx.prisma))
        .expect(409);
      expect(again.body.message).toBe('You already have a shop');
    });

    it('gives a second shop with the same name a suffixed slug', async () => {
      const name = `Mwanza Cattle ${Date.now()}`;
      const a = await createVendor(ctx, admin.accessToken, { overrides: { shopName: name } });
      const b = await createVendor(ctx, admin.accessToken, { overrides: { shopName: name } });
      expect(b.vendor.slug).toBe(`${a.vendor.slug}-2`);
    });

    it('rejects a district from another region', async () => {
      const u = await registerUser(ctx);
      const d = await ctx.prisma.district.findFirstOrThrow({ orderBy: { id: 'asc' } });
      const other = await ctx.prisma.district.findFirstOrThrow({
        where: { regionId: { not: d.regionId } },
      });
      const res = await ctx
        .http()
        .post(`${API}/vendors/me`)
        .set(bearer(u.accessToken))
        .send(await validVendorBody(ctx.prisma, { districtId: other.id }))
        .expect(400);
      expect(res.body.message).toBe('District does not belong to the selected region');
    });

    it.each([
      ['an empty species list', { species: [] }],
      ['an unsupported product as species', { species: ['MILK'] }],
      ['duplicate species', { species: ['GOAT', 'GOAT'] }],
      ['an invalid phone', { businessPhone: '12345' }],
      ['a too-short name', { shopName: 'A' }],
      ['a symbols-only name', { shopName: '!!!' }],
    ])('rejects %s', async (_label, override) => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .post(`${API}/vendors/me`)
        .set(bearer(u.accessToken))
        .send(await validVendorBody(ctx.prisma, override as object))
        .expect(400);
    });

    it('rejects unknown fields', async () => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .post(`${API}/vendors/me`)
        .set(bearer(u.accessToken))
        .send({ ...(await validVendorBody(ctx.prisma)), status: 'APPROVED' })
        .expect(400);
    });

    it('requires sign-in and a shop', async () => {
      await ctx.http().get(`${API}/vendors/me`).expect(401);
      const u = await registerUser(ctx);
      const res = await ctx.http().get(`${API}/vendors/me`).set(bearer(u.accessToken)).expect(404);
      expect(res.body.message).toBe('You do not have a shop');
    });

    it('edits details without changing the slug, and refuses resubmitting a PENDING shop', async () => {
      const { user, vendor } = await createVendor(ctx, admin.accessToken);
      const res = await ctx
        .http()
        .patch(`${API}/vendors/me`)
        .set(bearer(user.accessToken))
        .send({ shopName: 'Completely New Name', species: ['GOAT', 'SHEEP'] })
        .expect(200);
      expect(res.body).toMatchObject({
        slug: vendor.slug,
        shopName: 'Completely New Name',
        species: ['GOAT', 'SHEEP'],
      });
      const r = await ctx
        .http()
        .post(`${API}/vendors/me/resubmit`)
        .set(bearer(user.accessToken))
        .expect(409);
      expect(r.body.message).toBe('Cannot resubmit a shop that is PENDING');
    });

    it('forbids admins from applying', async () => {
      await ctx
        .http()
        .post(`${API}/vendors/me`)
        .set(bearer(admin.accessToken))
        .send(await validVendorBody(ctx.prisma))
        .expect(403);
    });
  });

  // ------------------------------------------------------------------------------ US3
  describe('public browsing (US3)', () => {
    let tag: string;
    let visible: { slug: string };
    let inactiveOwner: { userId: string; slug: string };
    const hidden: string[] = [];

    beforeAll(async () => {
      tag = `Zz${Date.now()}`;
      const regions = await ctx.prisma.region.findMany({
        include: { districts: { take: 1 } },
        orderBy: { id: 'asc' },
        take: 2,
      });
      const [r1, r2] = regions;
      const mk = (name: string, region = r1, species = ['CATTLE']) => ({
        shopName: `${tag} ${name}`,
        regionId: region.id,
        districtId: region.districts[0].id,
        species,
      });

      visible = (
        await createVendor(ctx, admin.accessToken, {
          approve: true,
          overrides: mk('Visible', r1, ['CATTLE', 'GOAT']),
        })
      ).vendor;
      await createVendor(ctx, admin.accessToken, {
        approve: true,
        overrides: mk('Second', r2, ['CHICKEN']),
      });

      const pending = await createVendor(ctx, admin.accessToken, { overrides: mk('Pending') });
      hidden.push(pending.vendor.slug);

      const rejected = await createVendor(ctx, admin.accessToken, { overrides: mk('Rejected') });
      await ctx
        .http()
        .post(`${API}/admin/vendors/${rejected.vendor.id}/reject`)
        .set(bearer(admin.accessToken))
        .send({ reason: 'No' })
        .expect(200);
      hidden.push(rejected.vendor.slug);

      const suspended = await createVendor(ctx, admin.accessToken, {
        approve: true,
        overrides: mk('Suspended'),
      });
      await ctx
        .http()
        .post(`${API}/admin/vendors/${suspended.vendor.id}/suspend`)
        .set(bearer(admin.accessToken))
        .expect(200);
      hidden.push(suspended.vendor.slug);

      const inactive = await createVendor(ctx, admin.accessToken, {
        approve: true,
        overrides: mk('Inactive Owner'),
      });
      await ctx
        .http()
        .patch(`${API}/admin/users/${inactive.user.id}/status`)
        .set(bearer(admin.accessToken))
        .send({ isActive: false })
        .expect(200);
      hidden.push(inactive.vendor.slug);
      inactiveOwner = { userId: inactive.user.id, slug: inactive.vendor.slug };
    });

    it('lists only approved shops of active owners, anonymously', async () => {
      const res = await ctx.http().get(`${API}/vendors`).query({ search: tag }).expect(200);
      expect(res.body.total).toBe(2);
      const names = res.body.items.map((v: { shopName: string }) => v.shopName).sort();
      expect(names).toEqual([`${tag} Second`, `${tag} Visible`]);
    });

    it('filters by region, district, species and name', async () => {
      const v = await ctx.http().get(`${API}/vendors/${visible.slug}`).expect(200);
      const byRegion = await ctx
        .http()
        .get(`${API}/vendors`)
        .query({ search: tag, regionId: v.body.region.id })
        .expect(200);
      expect(byRegion.body.items.map((x: { slug: string }) => x.slug)).toEqual([visible.slug]);

      const byDistrict = await ctx
        .http()
        .get(`${API}/vendors`)
        .query({ search: tag, districtId: v.body.district.id })
        .expect(200);
      expect(byDistrict.body.total).toBe(1);

      const bySpecies = await ctx
        .http()
        .get(`${API}/vendors`)
        .query({ search: tag, species: 'CHICKEN' })
        .expect(200);
      expect(bySpecies.body.items.map((x: { shopName: string }) => x.shopName)).toEqual([
        `${tag} Second`,
      ]);

      const byName = await ctx
        .http()
        .get(`${API}/vendors`)
        .query({ search: `${tag} visi`.toLowerCase() })
        .expect(200);
      expect(byName.body.total).toBe(1);
    });

    it('shows a shop page without private fields', async () => {
      const res = await ctx.http().get(`${API}/vendors/${visible.slug}`).expect(200);
      for (const key of [
        'payoutAccount',
        'rejectionReason',
        'reviewedBy',
        'owner',
        'status',
        'id',
      ]) {
        expect(res.body).not.toHaveProperty(key);
      }
      expect(res.body).toMatchObject({ slug: visible.slug, species: ['CATTLE', 'GOAT'] });
    });

    it('reports hidden shops as not found', async () => {
      for (const slug of hidden) {
        await ctx.http().get(`${API}/vendors/${slug}`).expect(404);
      }
      await ctx.http().get(`${API}/vendors/does-not-exist`).expect(404);
    });

    it('validates query parameters', async () => {
      await ctx.http().get(`${API}/vendors`).query({ limit: 101 }).expect(400);
      await ctx.http().get(`${API}/vendors`).query({ species: 'MILK' }).expect(400);
    });

    // Runs last: it makes a previously hidden shop visible again.
    it('shows a shop again once its owner is reactivated', async () => {
      await ctx
        .http()
        .patch(`${API}/admin/users/${inactiveOwner.userId}/status`)
        .set(bearer(admin.accessToken))
        .send({ isActive: true })
        .expect(200);
      await ctx.http().get(`${API}/vendors/${inactiveOwner.slug}`).expect(200);
      const res = await ctx.http().get(`${API}/vendors`).query({ search: tag }).expect(200);
      expect(res.body.total).toBe(3);
    });
  });

  // ------------------------------------------------------------------------------ US4
  describe('logo & payout (US4)', () => {
    it('uploads, replaces and removes a logo', async () => {
      const { user, vendor } = await createVendor(ctx, admin.accessToken);
      const up = await ctx
        .http()
        .put(`${API}/vendors/me/logo`)
        .set(bearer(user.accessToken))
        .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
        .expect(200);
      expect(up.body.logoUrl).toMatch(
        new RegExp(`^http://storage.test/vendors/${vendor.id}/logo-.+\\.png$`),
      );
      const firstKey = (up.body.logoUrl as string).replace('http://storage.test/', '');
      expect(ctx.storage.objects.get(firstKey)?.contentType).toBe('image/png');

      const again = await ctx
        .http()
        .put(`${API}/vendors/me/logo`)
        .set(bearer(user.accessToken))
        .attach('file', PNG, 'logo2.png')
        .expect(200);
      expect(again.body.logoUrl).not.toBe(up.body.logoUrl);
      expect(ctx.storage.objects.has(firstKey)).toBe(false);

      const del = await ctx
        .http()
        .delete(`${API}/vendors/me/logo`)
        .set(bearer(user.accessToken))
        .expect(200);
      expect(del.body.logoUrl).toBeNull();
    });

    it('rejects disguised, oversize and missing files', async () => {
      const { user } = await createVendor(ctx, admin.accessToken);
      const fake = await ctx
        .http()
        .put(`${API}/vendors/me/logo`)
        .set(bearer(user.accessToken))
        .attach('file', Buffer.from('just some text'), {
          filename: 'logo.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect(fake.body.message).toBe('Logo must be a JPEG, PNG or WebP image');

      const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1 - PNG.length)]);
      const tooBig = await ctx
        .http()
        .put(`${API}/vendors/me/logo`)
        .set(bearer(user.accessToken))
        .attach('file', big, 'big.png')
        .expect(413);
      expect(tooBig.body).toMatchObject({ statusCode: 413, message: 'Logo must be at most 2 MB' });

      await ctx.http().put(`${API}/vendors/me/logo`).set(bearer(user.accessToken)).expect(400);
    });

    it('tells users without a shop', async () => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .put(`${API}/vendors/me/logo`)
        .set(bearer(u.accessToken))
        .attach('file', PNG, 'logo.png')
        .expect(404);
      await ctx
        .http()
        .put(`${API}/vendors/me/payout-account`)
        .set(bearer(u.accessToken))
        .send({
          method: 'BANK',
          bankName: 'NMB',
          accountNumber: '20110012345',
          accountName: 'Juma',
        })
        .expect(404);
    });

    it('sets mobile money, switches to bank, and hides it publicly', async () => {
      const { user, vendor } = await createVendor(ctx, admin.accessToken, { approve: true });
      await ctx
        .http()
        .get(`${API}/vendors/me/payout-account`)
        .set(bearer(user.accessToken))
        .expect(404);

      const mobile = await ctx
        .http()
        .put(`${API}/vendors/me/payout-account`)
        .set(bearer(user.accessToken))
        .send({
          method: 'MOBILE_MONEY',
          provider: 'MPESA',
          mobileNumber: '0754123456',
          accountName: 'Juma Hamisi',
        })
        .expect(200);
      expect(mobile.body).toMatchObject({
        method: 'MOBILE_MONEY',
        provider: 'MPESA',
        mobileNumber: '+255754123456',
      });

      const bank = await ctx
        .http()
        .put(`${API}/vendors/me/payout-account`)
        .set(bearer(user.accessToken))
        .send({
          method: 'BANK',
          bankName: 'CRDB Bank',
          accountNumber: '0150123456700',
          accountName: 'Juma Hamisi',
        })
        .expect(200);
      expect(bank.body).toMatchObject({ method: 'BANK', accountNumber: '0150123456700' });
      expect(bank.body).not.toHaveProperty('provider');

      const mine = await ctx
        .http()
        .get(`${API}/vendors/me/payout-account`)
        .set(bearer(user.accessToken))
        .expect(200);
      expect(mine.body.method).toBe('BANK');

      const adminView = await ctx
        .http()
        .get(`${API}/admin/vendors/${vendor.id}`)
        .set(bearer(admin.accessToken))
        .expect(200);
      expect(adminView.body.payoutAccount).toMatchObject({ method: 'BANK', bankName: 'CRDB Bank' });

      const pub = await ctx.http().get(`${API}/vendors/${vendor.slug}`).expect(200);
      expect(pub.body).not.toHaveProperty('payoutAccount');
    });

    it.each([
      [
        'bank with a provider',
        { method: 'BANK', bankName: 'NMB', accountNumber: '20110012345', provider: 'MPESA' },
      ],
      ['mobile money without a provider', { method: 'MOBILE_MONEY', mobileNumber: '0754123456' }],
      ['bank without an account number', { method: 'BANK', bankName: 'NMB' }],
      [
        'bank with a non-numeric account',
        { method: 'BANK', bankName: 'NMB', accountNumber: 'ABC123456' },
      ],
    ])('rejects %s', async (_label, body) => {
      const { user } = await createVendor(ctx, admin.accessToken);
      await ctx
        .http()
        .put(`${API}/vendors/me/payout-account`)
        .set(bearer(user.accessToken))
        .send({ accountName: 'Juma Hamisi', ...body })
        .expect(400);
    });

    it('enforces payout field rules in the database too', async () => {
      const { vendor } = await createVendor(ctx, admin.accessToken);
      await expect(
        ctx.prisma.vendorPayoutAccount.create({
          data: {
            vendorId: vendor.id,
            method: 'BANK',
            bankName: 'NMB',
            accountNumber: '20110012345',
            provider: 'MPESA',
            accountName: 'Juma',
          },
        }),
      ).rejects.toThrow(/payout_method_fields/);
    });

    it('refuses an empty species list in the database too', async () => {
      const { vendor } = await createVendor(ctx, admin.accessToken);
      await expect(
        ctx.prisma.vendor.update({ where: { id: vendor.id }, data: { species: [] } }),
      ).rejects.toThrow(/vendors_species_not_empty/);
    });

    it('blocks logo and payout changes while suspended', async () => {
      const { user, vendor } = await createVendor(ctx, admin.accessToken, { approve: true });
      await ctx
        .http()
        .post(`${API}/admin/vendors/${vendor.id}/suspend`)
        .set(bearer(admin.accessToken))
        .expect(200);
      await ctx
        .http()
        .put(`${API}/vendors/me/logo`)
        .set(bearer(user.accessToken))
        .attach('file', PNG, 'logo.png')
        .expect(403);
      await ctx
        .http()
        .put(`${API}/vendors/me/payout-account`)
        .set(bearer(user.accessToken))
        .send({
          method: 'BANK',
          bankName: 'NMB',
          accountNumber: '20110012345',
          accountName: 'Juma',
        })
        .expect(403);
    });
  });

  it('keeps `applyVendor` usable directly (helper smoke)', async () => {
    const u = await registerUser(ctx);
    const v = await applyVendor(ctx, u.accessToken);
    expect(v.status).toBe('PENDING');
  });
});
