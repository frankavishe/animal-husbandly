import { randomUUID } from 'crypto';
import {
  API,
  bearer,
  createApp,
  createListing,
  createVendor,
  JPEG,
  loginAdmin,
  PNG,
  publishListing,
  registerUser,
  resetUsers,
  TestContext,
} from './utils';

const LISTINGS = `${API}/vendors/me/listings`;
const ORDER_MESSAGE = 'photoIds must list every photo of the listing exactly once';
const ARCHIVED_MESSAGE = 'Cannot change photos of a listing that is ARCHIVED';

describe('Listing photos (US4)', () => {
  let ctx: TestContext;
  let admin: { id: string; accessToken: string };
  let token: string;
  let listingId: string;

  type Photo = { id: string; url: string; position: number };

  const upload = (t: string, id: string, buf: Buffer, filename: string, contentType?: string) =>
    ctx
      .http()
      .post(`${LISTINGS}/${id}/photos`)
      .set(bearer(t))
      .attach('file', buf, contentType ? { filename, contentType } : filename);
  const reorder = (t: string, id: string, photoIds: unknown) =>
    ctx.http().put(`${LISTINGS}/${id}/photos/order`).set(bearer(t)).send({ photoIds });
  const remove = (t: string, id: string, photoId: string) =>
    ctx.http().delete(`${LISTINGS}/${id}/photos/${photoId}`).set(bearer(t));
  const getMine = async (): Promise<{ photos: Photo[]; coverUrl: string | null }> =>
    (await ctx.http().get(`${LISTINGS}/${listingId}`).set(bearer(token)).expect(200)).body;
  const keyOf = (url: string) => url.replace('http://storage.test/', '');
  const photoKeys = () =>
    [...ctx.storage.objects.keys()].filter((k) => k.startsWith(`listings/${listingId}/`));

  async function approvedVendor() {
    const { user, vendor } = await createVendor(ctx, admin.accessToken, { approve: true });
    return { token: user.accessToken, vendor };
  }

  beforeAll(async () => {
    ctx = await createApp();
    await resetUsers(ctx.prisma);
    admin = await loginAdmin(ctx);
    const v = await approvedVendor();
    token = v.token;
    listingId = (await createListing(ctx, token)).id;
    await publishListing(ctx, token, listingId);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('uploads PNG, JPEG, PNG at positions 0–2; the first is the cover', async () => {
    await upload(token, listingId, PNG, 'a.png', 'image/png').expect(201);
    await upload(token, listingId, JPEG, 'b.jpg', 'image/jpeg').expect(201);
    const res = await upload(token, listingId, PNG, 'c.png', 'image/png').expect(201);

    const photos: Photo[] = res.body.photos;
    expect(photos.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(res.body.coverUrl).toBe(photos[0].url);
    for (const p of photos) {
      expect(keyOf(p.url)).toMatch(new RegExp(`^listings/${listingId}/[0-9a-f-]{36}\\.(png|jpg)$`));
      expect(ctx.storage.objects.has(keyOf(p.url))).toBe(true);
    }
    expect(ctx.storage.objects.get(keyOf(photos[1].url))?.contentType).toBe('image/jpeg');
    expect(keyOf(photos[1].url)).toMatch(/\.jpg$/);
    expect(photoKeys()).toHaveLength(3);
  });

  it('reorders; the new cover shows on the public listing too', async () => {
    const before = await getMine();
    const reversed = before.photos.map((p) => p.id).reverse();
    const res = await reorder(token, listingId, reversed).expect(200);
    expect(res.body.photos.map((p: Photo) => p.id)).toEqual(reversed);
    expect(res.body.photos.map((p: Photo) => p.position)).toEqual([0, 1, 2]);
    expect(res.body.coverUrl).toBe(before.photos[2].url);

    const pub = await ctx.http().get(`${API}/listings/${listingId}`).expect(200);
    expect(pub.body.photos.map((p: Photo) => p.id)).toEqual(reversed);
    expect(pub.body.coverUrl).toBe(before.photos[2].url);
  });

  it('refuses a reorder that is not exactly the current set', async () => {
    const ids = (await getMine()).photos.map((p) => p.id);
    for (const body of [ids.slice(0, 2), [...ids.slice(0, 2), randomUUID()]]) {
      const res = await reorder(token, listingId, body).expect(400);
      expect(res.body.message).toBe(ORDER_MESSAGE);
    }
    // Shape errors are caught by the DTO.
    await reorder(token, listingId, [ids[0], ids[0], ids[1]]).expect(400);
    await reorder(token, listingId, [...ids.slice(0, 2), 'not-a-uuid']).expect(400);
    await reorder(token, listingId, []).expect(400);
    await reorder(token, listingId, 'nope').expect(400);
    expect((await getMine()).photos.map((p) => p.id)).toEqual(ids);
  });

  it('refuses a disguised file, an oversized file and a missing file', async () => {
    const fake = await upload(
      token,
      listingId,
      Buffer.from('just some text'),
      'photo.jpg',
      'image/jpeg',
    ).expect(400);
    expect(fake.body.message).toBe('Photo must be a JPEG, PNG or WebP image');

    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1 - PNG.length)]);
    const tooBig = await upload(token, listingId, big, 'big.png').expect(413);
    expect(tooBig.body).toMatchObject({ statusCode: 413, message: 'Photo must be at most 5 MB' });

    const missing = await ctx
      .http()
      .post(`${LISTINGS}/${listingId}/photos`)
      .set(bearer(token))
      .expect(400);
    expect(missing.body.message).toBe('A photo file is required');

    expect(photoKeys()).toHaveLength(3);
  });

  it('allows 5 photos and refuses a sixth', async () => {
    await upload(token, listingId, PNG, 'd.png').expect(201);
    await upload(token, listingId, PNG, 'e.png').expect(201);
    const sixth = await upload(token, listingId, PNG, 'f.png').expect(409);
    expect(sixth.body.message).toBe('A listing can have at most 5 photos');
    expect(photoKeys()).toHaveLength(5);
    expect((await getMine()).photos.map((p) => p.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('removes a middle photo, compacts positions and deletes the object', async () => {
    const before = await getMine();
    const middle = before.photos[2];
    const res = await remove(token, listingId, middle.id).expect(200);
    expect(res.body.photos.map((p: Photo) => p.position)).toEqual([0, 1, 2, 3]);
    expect(res.body.photos.map((p: Photo) => p.id)).toEqual(
      before.photos.filter((p) => p.id !== middle.id).map((p) => p.id),
    );
    expect(ctx.storage.objects.has(keyOf(middle.url))).toBe(false);
    expect(photoKeys()).toHaveLength(4);

    const again = await remove(token, listingId, middle.id).expect(404);
    expect(again.body.message).toBe('Photo not found');
  });

  it("hides another vendor's listing (404) and enforces auth and role", async () => {
    const other = await approvedVendor();
    const ids = (await getMine()).photos.map((p) => p.id);

    for (const res of [
      await upload(other.token, listingId, PNG, 'x.png'),
      await remove(other.token, listingId, ids[0]),
      await reorder(other.token, listingId, ids),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Listing not found');
    }

    const customer = await registerUser(ctx);
    await upload(customer.accessToken, listingId, PNG, 'x.png').expect(403);
    await ctx
      .http()
      .post(`${LISTINGS}/${listingId}/photos`)
      .attach('file', PNG, 'x.png')
      .expect(401);
    await ctx.http().post(`${LISTINGS}/not-a-uuid/photos`).set(bearer(token)).expect(400);
    expect(photoKeys()).toHaveLength(4);
  });

  it('refuses photo changes on a suspended shop (403)', async () => {
    const s = await approvedVendor();
    const id = (await createListing(ctx, s.token)).id;
    await upload(s.token, id, PNG, 'ok.png').expect(201);
    await ctx
      .http()
      .post(`${API}/admin/vendors/${s.vendor.id}/suspend`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const res = await upload(s.token, id, PNG, 'no.png').expect(403);
    expect(res.body.message).toBe('Your shop is suspended');
  });

  it('keeps photos after archive and refuses further photo changes (409)', async () => {
    const before = await getMine();
    await ctx.http().post(`${LISTINGS}/${listingId}/archive`).set(bearer(token)).expect(200);

    for (const p of before.photos) expect(ctx.storage.objects.has(keyOf(p.url))).toBe(true);
    const ids = before.photos.map((p) => p.id);
    for (const res of [
      await upload(token, listingId, PNG, 'late.png'),
      await remove(token, listingId, ids[0]),
      await reorder(token, listingId, [...ids].reverse()),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(ARCHIVED_MESSAGE);
    }
    expect((await getMine()).photos.map((p) => p.id)).toEqual(ids);
    expect(photoKeys()).toHaveLength(4);
  });
});
