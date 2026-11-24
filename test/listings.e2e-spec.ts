import {
  API,
  bearer,
  createListing,
  createVendor,
  loginAdmin,
  publishListing,
  registerUser,
  resetUsers,
  TestContext,
  createApp,
  validListingBody,
} from './utils';

const ALL_SPECIES = ['CATTLE', 'GOAT', 'SHEEP', 'PIG', 'CHICKEN', 'FISH'];
const LISTINGS = `${API}/vendors/me/listings`;

describe('Listings', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };

  /** An approved vendor whose shop deals in every species unless overridden. */
  async function approvedVendor(species = ALL_SPECIES, extra: Record<string, unknown> = {}) {
    const { user, vendor } = await createVendor(ctx, admin.accessToken, {
      approve: true,
      overrides: { species, ...extra },
    });
    return { token: user.accessToken, userId: user.id, vendor };
  }

  const post = (token: string, body: object) =>
    ctx.http().post(LISTINGS).set(bearer(token)).send(body);
  const action = (token: string, id: string, name: string) =>
    ctx.http().post(`${LISTINGS}/${id}/${name}`).set(bearer(token));

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  // ------------------------------------------------------------------------------ US1
  describe('vendor (US1)', () => {
    let v: Awaited<ReturnType<typeof approvedVendor>>;
    beforeAll(async () => {
      v = await approvedVendor();
    });

    it('creates a LIVE_ANIMAL cattle listing as DRAFT (scenario 1)', async () => {
      const res = await post(v.token, validListingBody({ weightKg: 350.5 })).expect(201);
      expect(res.body).toMatchObject({
        title: 'Boran heifer',
        species: 'CATTLE',
        listingType: 'LIVE_ANIMAL',
        unit: 'HEAD',
        unitPrice: 1200000,
        stockQuantity: 3,
        inStock: true,
        status: 'DRAFT',
        animal: { breed: 'Boran', sex: 'FEMALE', ageMonths: 30, weightKg: 350.5 },
        photos: [],
        coverUrl: null,
        publishedAt: null,
        takenDownReason: null,
        shop: { slug: v.vendor.slug },
      });
    });

    it.each([
      ['GOAT', 'MILK', 'LITRE', 'MILK listings are only allowed for CATTLE'],
      ['SHEEP', 'MILK', 'LITRE', 'MILK listings are only allowed for CATTLE'],
      ['PIG', 'MILK', 'LITRE', 'MILK listings are only allowed for CATTLE'],
      ['CATTLE', 'EGGS', 'TRAY', 'EGGS listings are only allowed for CHICKEN'],
      ['FISH', 'EGGS', 'PIECE', 'EGGS listings are only allowed for CHICKEN'],
    ])('refuses %s %s (scenario 2)', async (species, listingType, unit, message) => {
      const res = await post(v.token, {
        title: 'Not allowed',
        species,
        listingType,
        unit,
        unitPrice: 1000,
        stockQuantity: 1,
      }).expect(400);
      expect(res.body.message).toBe(message);
    });

    it('accepts MILK for CATTLE, EGGS for CHICKEN, MEAT and LIVE_ANIMAL for all species (scenario 3)', async () => {
      await post(v.token, {
        title: 'Fresh milk',
        species: 'CATTLE',
        listingType: 'MILK',
        unit: 'LITRE',
        unitPrice: 1500,
        stockQuantity: 40,
      }).expect(201);
      const eggs = await post(v.token, {
        title: 'Kienyeji eggs',
        species: 'CHICKEN',
        listingType: 'EGGS',
        unit: 'TRAY',
        unitPrice: 12000,
        stockQuantity: 5,
      }).expect(201);
      expect(eggs.body.animal).toBeNull();
      for (const species of ALL_SPECIES) {
        await post(v.token, {
          title: `${species} meat`,
          species,
          listingType: 'MEAT',
          unit: 'KG',
          unitPrice: 9000,
          stockQuantity: 20,
        }).expect(201);
        await post(v.token, validListingBody({ species, title: `${species} live` })).expect(201);
      }
    });

    it('refuses a species the shop does not deal in (scenario 4)', async () => {
      const goatShop = await approvedVendor(['GOAT', 'SHEEP']);
      const res = await post(goatShop.token, validListingBody()).expect(400);
      expect(res.body.message).toBe('Your shop does not deal in CATTLE');
    });

    it('refuses units outside the type set (scenario 5)', async () => {
      const milk = await post(v.token, {
        title: 'Milk by kg',
        species: 'CATTLE',
        listingType: 'MILK',
        unit: 'KG',
        unitPrice: 1500,
        stockQuantity: 1,
      }).expect(400);
      expect(milk.body.message).toBe('Unit KG is not allowed for MILK listings');
      const eggs = await post(v.token, {
        title: 'Eggs by head',
        species: 'CHICKEN',
        listingType: 'EGGS',
        unit: 'HEAD',
        unitPrice: 500,
        stockQuantity: 1,
      }).expect(400);
      expect(eggs.body.message).toBe('Unit HEAD is not allowed for EGGS listings');
    });

    it('enforces live-animal fields (scenario 6)', async () => {
      for (const missing of ['breed', 'sex', 'ageMonths']) {
        const body: Record<string, unknown> = { ...validListingBody() };
        delete body[missing];
        const res = await post(v.token, body).expect(400);
        expect(res.body.message).toBe('LIVE_ANIMAL listings require breed, sex and ageMonths');
      }
      const meat = await post(v.token, {
        title: 'Beef',
        species: 'CATTLE',
        listingType: 'MEAT',
        unit: 'KG',
        unitPrice: 12000,
        stockQuantity: 50,
        breed: 'Boran',
      }).expect(400);
      expect(meat.body.message).toBe('breed is only allowed for LIVE_ANIMAL listings');
    });

    it('refuses bad numbers (scenario 7) and accepts 0.1 kg precision', async () => {
      for (const bad of [
        { unitPrice: 0 },
        { unitPrice: -5 },
        { unitPrice: 1.5 },
        { unitPrice: 1_000_000_001 },
        { stockQuantity: -1 },
        { stockQuantity: 2.5 },
        { stockQuantity: 1_000_001 },
        { weightKg: 350.55 },
        { weightKg: 0 },
        { ageMonths: 601 },
        { title: 'ab' },
      ]) {
        await post(v.token, validListingBody(bad)).expect(400);
      }
      await post(v.token, validListingBody({ weightKg: 350.5 })).expect(201);
    });

    it('refuses customers, non-approved shops, unknown fields and anonymous callers (scenario 8)', async () => {
      const customer = await registerUser(ctx);
      await post(customer.accessToken, validListingBody()).expect(403);

      const pending = await createVendor(ctx, admin.accessToken, { approve: false });
      await post(pending.user.accessToken, validListingBody()).expect(403);

      const suspended = await approvedVendor();
      await ctx
        .http()
        .post(`${API}/admin/vendors/${suspended.vendor.id}/suspend`)
        .set(bearer(admin.accessToken))
        .expect(200);
      const s = await post(suspended.token, validListingBody()).expect(403);
      expect(s.body.message).toBe('Your shop is suspended');

      await post(v.token, { ...validListingBody(), vendorId: 'x' }).expect(400);
      await ctx.http().post(LISTINGS).send(validListingBody()).expect(401);
    });

    it('lists, views and edits own listings; other vendors get 404 (scenario 9)', async () => {
      const mine = await createListing(ctx, v.token);
      const list = await ctx.http().get(LISTINGS).set(bearer(v.token)).expect(200);
      expect(list.body.items.map((l: { id: string }) => l.id)).toContain(mine.id);
      expect(list.body.items[0].id).toBe(mine.id); // newest created first

      await ctx.http().get(`${LISTINGS}/${mine.id}`).set(bearer(v.token)).expect(200);
      const edited = await ctx
        .http()
        .patch(`${LISTINGS}/${mine.id}`)
        .set(bearer(v.token))
        .send({ unitPrice: 1500000 })
        .expect(200);
      expect(edited.body.unitPrice).toBe(1500000);
      expect(edited.body.animal.breed).toBe('Boran');

      const other = await approvedVendor();
      await ctx.http().get(`${LISTINGS}/${mine.id}`).set(bearer(other.token)).expect(404);
      await ctx
        .http()
        .patch(`${LISTINGS}/${mine.id}`)
        .set(bearer(other.token))
        .send({ unitPrice: 1 })
        .expect(404);
      await action(other.token, mine.id, 'publish').expect(404);
      await ctx.http().get(`${LISTINGS}/not-a-uuid`).set(bearer(v.token)).expect(400);
    });

    it('re-checks rules on DRAFT type changes and locks them after publishing (scenario 10)', async () => {
      const draft = await createListing(ctx, v.token);
      // Switching to MEAT without dropping animal details is refused…
      await ctx
        .http()
        .patch(`${LISTINGS}/${draft.id}`)
        .set(bearer(v.token))
        .send({ listingType: 'MEAT', unit: 'KG' })
        .expect(400);
      // …and accepted when they are cleared in the same request.
      const meat = await ctx
        .http()
        .patch(`${LISTINGS}/${draft.id}`)
        .set(bearer(v.token))
        .send({ listingType: 'MEAT', unit: 'KG', breed: null, sex: null, ageMonths: null })
        .expect(200);
      expect(meat.body).toMatchObject({ listingType: 'MEAT', unit: 'KG', animal: null });
      await ctx
        .http()
        .patch(`${LISTINGS}/${draft.id}`)
        .set(bearer(v.token))
        .send({ listingType: 'MILK', unit: 'LITRE', species: 'GOAT' })
        .expect(400);

      await publishListing(ctx, v.token, draft.id);
      const locked = await ctx
        .http()
        .patch(`${LISTINGS}/${draft.id}`)
        .set(bearer(v.token))
        .send({ species: 'GOAT' })
        .expect(409);
      expect(locked.body.message).toBe(
        'Species and listing type can only be changed while the listing is DRAFT (current: ACTIVE)',
      );
      const stillActive = await ctx
        .http()
        .patch(`${LISTINGS}/${draft.id}`)
        .set(bearer(v.token))
        .send({ title: 'Prime beef' })
        .expect(200);
      expect(stillActive.body.status).toBe('ACTIVE');
    });

    it('accepts a group LIVE_ANIMAL goat listing (scenario 11)', async () => {
      const goats = await approvedVendor(['GOAT']);
      const res = await post(
        goats.token,
        validListingBody({
          title: 'Small East African goats',
          species: 'GOAT',
          stockQuantity: 10,
          breed: 'Small East African',
          sex: 'MIXED',
          ageMonths: 8,
        }),
      ).expect(201);
      expect(res.body.animal).toMatchObject({ sex: 'MIXED', ageMonths: 8 });
      expect(res.body.stockQuantity).toBe(10);
    });

    it('the database itself rejects GOAT MILK (SC-002)', async () => {
      await expect(
        ctx.prisma.$executeRaw`
          INSERT INTO listings (id, vendor_id, title, species, listing_type, unit, unit_price, stock_quantity, updated_at)
          VALUES (gen_random_uuid(), ${v.vendor.id}::uuid, 'Goat milk', 'GOAT', 'MILK', 'LITRE', 1000, 1, now())`,
      ).rejects.toThrow(/listings_species_type/);
      await expect(
        ctx.prisma.$executeRaw`
          INSERT INTO listings (id, vendor_id, title, species, listing_type, unit, unit_price, stock_quantity, updated_at)
          VALUES (gen_random_uuid(), ${v.vendor.id}::uuid, 'Cattle eggs', 'CATTLE', 'EGGS', 'TRAY', 1000, 1, now())`,
      ).rejects.toThrow(/listings_species_type/);
      await expect(
        ctx.prisma.$executeRaw`
          INSERT INTO listings (id, vendor_id, title, species, listing_type, unit, unit_price, stock_quantity, updated_at)
          VALUES (gen_random_uuid(), ${v.vendor.id}::uuid, 'Milk by kg', 'CATTLE', 'MILK', 'KG', 1000, 1, now())`,
      ).rejects.toThrow(/listings_unit_type/);
    });
  });

  // ------------------------------------------------------------------------------ US2
  describe('lifecycle (US2)', () => {
    let v: Awaited<ReturnType<typeof approvedVendor>>;
    beforeAll(async () => {
      v = await approvedVendor();
    });

    it('publish → pause → activate → archive (scenarios 1–3)', async () => {
      const l = await createListing(ctx, v.token);
      const published = await publishListing(ctx, v.token, l.id);
      expect(published.status).toBe('ACTIVE');
      expect(published.publishedAt).not.toBeNull();

      const paused = await action(v.token, l.id, 'pause').expect(200);
      expect(paused.body.status).toBe('INACTIVE');
      const active = await action(v.token, l.id, 'activate').expect(200);
      expect(active.body.status).toBe('ACTIVE');
      expect(active.body.publishedAt).toBe(published.publishedAt);

      const archived = await action(v.token, l.id, 'archive').expect(200);
      expect(archived.body.status).toBe('ARCHIVED');
      expect(archived.body.archivedAt).not.toBeNull();

      const normal = await ctx.http().get(LISTINGS).set(bearer(v.token)).expect(200);
      expect(normal.body.items.map((x: { id: string }) => x.id)).not.toContain(l.id);
      const onlyArchived = await ctx
        .http()
        .get(`${LISTINGS}?status=ARCHIVED`)
        .set(bearer(v.token))
        .expect(200);
      expect(onlyArchived.body.items.map((x: { id: string }) => x.id)).toEqual([l.id]);

      const edit = await ctx
        .http()
        .patch(`${LISTINGS}/${l.id}`)
        .set(bearer(v.token))
        .send({ title: 'Back again' })
        .expect(409);
      expect(edit.body.message).toBe('Cannot edit a listing that is ARCHIVED');
      for (const a of ['publish', 'activate', 'pause', 'archive']) {
        const res = await action(v.token, l.id, a).expect(409);
        expect(res.body.message).toBe(`Cannot ${a} a listing that is ARCHIVED`);
      }
    });

    it('refuses invalid steps naming the status (scenario 4)', async () => {
      const l = await createListing(ctx, v.token);
      const pause = await action(v.token, l.id, 'pause').expect(409);
      expect(pause.body.message).toBe('Cannot pause a listing that is DRAFT');
      await action(v.token, l.id, 'activate').expect(409);
      await publishListing(ctx, v.token, l.id);
      const again = await action(v.token, l.id, 'publish').expect(409);
      expect(again.body.message).toBe('Cannot publish a listing that is ACTIVE');

      await ctx.prisma.listing.update({ where: { id: l.id }, data: { status: 'TAKEN_DOWN' } });
      const td = await action(v.token, l.id, 'publish').expect(409);
      expect(td.body.message).toBe('Cannot publish a listing that is TAKEN_DOWN');
      await action(v.token, l.id, 'activate').expect(409);
    });

    it('publishes with stock 0 and shows it as out of stock (scenario 5)', async () => {
      const l = await createListing(ctx, v.token, { stockQuantity: 0 });
      await publishListing(ctx, v.token, l.id);
      const pub = await ctx.http().get(`${API}/listings/${l.id}`).expect(200);
      expect(pub.body).toMatchObject({ stockQuantity: 0, inStock: false });
    });

    it('suspended shop: edit and publish 403, pause and archive allowed (scenario 6)', async () => {
      const s = await approvedVendor();
      const draft = await createListing(ctx, s.token);
      const active = await createListing(ctx, s.token);
      await publishListing(ctx, s.token, active.id);
      await ctx
        .http()
        .post(`${API}/admin/vendors/${s.vendor.id}/suspend`)
        .set(bearer(admin.accessToken))
        .expect(200);

      await ctx
        .http()
        .patch(`${LISTINGS}/${active.id}`)
        .set(bearer(s.token))
        .send({ unitPrice: 5 })
        .expect(403);
      await action(s.token, draft.id, 'publish').expect(403);
      const paused = await action(s.token, active.id, 'pause').expect(200);
      expect(paused.body.status).toBe('INACTIVE');
      await action(s.token, active.id, 'activate').expect(403);
      await action(s.token, draft.id, 'archive').expect(200);
    });
  });

  // ------------------------------------------------------------------------------ US3
  describe('public (US3)', () => {
    const ids: Record<string, string> = {};
    let shopA: Awaited<ReturnType<typeof approvedVendor>>;
    let shopB: Awaited<ReturnType<typeof approvedVendor>>;
    let regionA: { id: number; districtId: number };
    let regionB: { id: number; districtId: number };

    const browse = (qs = '') => ctx.http().get(`${API}/listings${qs}`).expect(200);
    const idsOf = (res: { body: { items: Array<{ id: string }> } }) =>
      res.body.items.map((l) => l.id).sort();

    beforeAll(async () => {
      await resetUsers(ctx.prisma);
      admin = await loginAdmin(ctx);

      const [dA, dB] = await Promise.all([
        ctx.prisma.district.findFirstOrThrow({ orderBy: { id: 'asc' } }),
        ctx.prisma.district.findFirstOrThrow({ orderBy: { id: 'desc' } }),
      ]);
      expect(dA.regionId).not.toBe(dB.regionId);
      regionA = { id: dA.regionId, districtId: dA.id };
      regionB = { id: dB.regionId, districtId: dB.id };

      shopA = await approvedVendor(['CATTLE'], {
        regionId: regionA.id,
        districtId: regionA.districtId,
      });
      shopB = await approvedVendor(['CHICKEN'], {
        regionId: regionB.id,
        districtId: regionB.districtId,
      });

      // Visible
      ids.boran = (await createListing(ctx, shopA.token, { unitPrice: 500000 })).id;
      ids.cheap = (
        await createListing(ctx, shopA.token, {
          title: 'Zebu bull',
          description: 'Strong BORAN cross',
          unitPrice: 50000,
          stockQuantity: 0,
        })
      ).id;
      ids.eggs = (
        await createListing(ctx, shopB.token, {
          title: 'Kienyeji eggs',
          description: 'Free range',
          species: 'CHICKEN',
          listingType: 'EGGS',
          unit: 'TRAY',
          unitPrice: 12000,
          stockQuantity: 9,
          breed: undefined,
          sex: undefined,
          ageMonths: undefined,
        })
      ).id;
      for (const id of [ids.boran, ids.cheap]) await publishListing(ctx, shopA.token, id);
      await publishListing(ctx, shopB.token, ids.eggs);

      // Hidden: every other status
      ids.draft = (await createListing(ctx, shopA.token)).id;
      ids.inactive = (await createListing(ctx, shopA.token)).id;
      await publishListing(ctx, shopA.token, ids.inactive);
      await action(shopA.token, ids.inactive, 'pause').expect(200);
      ids.archived = (await createListing(ctx, shopA.token)).id;
      await action(shopA.token, ids.archived, 'archive').expect(200);
      ids.takenDown = (await createListing(ctx, shopA.token)).id;
      await ctx.prisma.listing.update({
        where: { id: ids.takenDown },
        data: { status: 'TAKEN_DOWN', takenDownReason: 'x' },
      });

      // Hidden: ACTIVE listing of a suspended shop and of a deactivated owner
      const suspended = await approvedVendor(['CATTLE']);
      ids.suspendedShop = (await createListing(ctx, suspended.token)).id;
      await publishListing(ctx, suspended.token, ids.suspendedShop);
      await ctx
        .http()
        .post(`${API}/admin/vendors/${suspended.vendor.id}/suspend`)
        .set(bearer(admin.accessToken))
        .expect(200);
      const deactivated = await approvedVendor(['CATTLE']);
      ids.inactiveOwner = (await createListing(ctx, deactivated.token)).id;
      await publishListing(ctx, deactivated.token, ids.inactiveOwner);
      await ctx.prisma.user.update({
        where: { id: deactivated.userId },
        data: { isActive: false },
      });
    });

    it('returns only visible listings, newest first (scenario 1)', async () => {
      const res = await browse();
      expect(idsOf(res)).toEqual([ids.boran, ids.cheap, ids.eggs].sort());
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3, totalPages: 1 });
      expect(res.body.items[0].id).toBe(ids.eggs);
    });

    it('filters by species, type, region, district and shop (scenario 2)', async () => {
      expect(idsOf(await browse('?species=CHICKEN'))).toEqual([ids.eggs]);
      expect(idsOf(await browse('?listingType=LIVE_ANIMAL'))).toEqual(
        [ids.boran, ids.cheap].sort(),
      );
      expect(idsOf(await browse(`?regionId=${regionB.id}`))).toEqual([ids.eggs]);
      expect(idsOf(await browse(`?districtId=${regionA.districtId}`))).toEqual(
        [ids.boran, ids.cheap].sort(),
      );
      expect(idsOf(await browse(`?shop=${shopB.vendor.slug}`))).toEqual([ids.eggs]);
      expect(idsOf(await browse(`?shop=${shopB.vendor.slug}&species=CATTLE`))).toEqual([]);
    });

    it('filters by price and sorts by price (scenario 3)', async () => {
      expect(idsOf(await browse('?minPrice=100000&maxPrice=1000000'))).toEqual([ids.boran]);
      const asc = await browse('?sort=price_asc');
      expect(asc.body.items.map((l: { unitPrice: number }) => l.unitPrice)).toEqual([
        12000, 50000, 500000,
      ]);
      const desc = await browse('?sort=price_desc');
      expect(desc.body.items.map((l: { unitPrice: number }) => l.unitPrice)).toEqual([
        500000, 50000, 12000,
      ]);
    });

    it('in-stock only excludes stock 0 (scenario 4)', async () => {
      expect(idsOf(await browse('?inStock=true'))).toEqual([ids.boran, ids.eggs].sort());
      expect(idsOf(await browse('?inStock=false'))).toHaveLength(3);
      await ctx.http().get(`${API}/listings?inStock=yes`).expect(400);
    });

    it('searches title and description case-insensitively (scenario 5)', async () => {
      expect(idsOf(await browse('?search=boran'))).toEqual([ids.boran, ids.cheap].sort());
      expect(idsOf(await browse('?search=FREE%20RANGE'))).toEqual([ids.eggs]);
    });

    it('detail shows the shop summary and no private data (scenario 6)', async () => {
      const res = await ctx.http().get(`${API}/listings/${ids.boran}`).expect(200);
      expect(res.body.shop).toEqual({
        slug: shopA.vendor.slug,
        shopName: expect.any(String),
        region: { id: regionA.id, name: expect.any(String) },
        district: { id: regionA.districtId, name: expect.any(String) },
      });
      for (const key of [
        'status',
        'takenDownReason',
        'takenDownAt',
        'vendor',
        'vendorId',
        'payoutAccount',
      ]) {
        expect(res.body).not.toHaveProperty(key);
      }
      expect(JSON.stringify(res.body)).not.toMatch(/businessPhone|payout|takenDown/);
    });

    it('hidden listings are 404 (scenario 7)', async () => {
      for (const key of [
        'draft',
        'inactive',
        'archived',
        'takenDown',
        'suspendedShop',
        'inactiveOwner',
      ]) {
        await ctx.http().get(`${API}/listings/${ids[key]}`).expect(404);
      }
      await ctx.http().get(`${API}/listings/not-a-uuid`).expect(400);
    });

    it('rejects bad filters', async () => {
      const res = await ctx.http().get(`${API}/listings?minPrice=5&maxPrice=1`).expect(400);
      expect(res.body.message).toBe('minPrice must not exceed maxPrice');
      await ctx.http().get(`${API}/listings?limit=101`).expect(400);
      await ctx.http().get(`${API}/listings?sort=cheapest`).expect(400);
      await ctx.http().get(`${API}/listings?species=DOG`).expect(400);
    });
  });
});
