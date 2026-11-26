import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AUTH_THROTTLER } from '../src/auth/auth.constants';
import { StorageService } from '../src/common/storage';
import { PrismaService } from '../src/prisma/prisma.service';
import request from 'supertest';
import type { App } from 'supertest/types';

export const API = '/api/v1';

/** In-memory object storage so e2e tests never need MinIO. */
export class InMemoryStorage extends StorageService {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  publicUrl(key: string): string {
    return `http://storage.test/${key}`;
  }
}

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaClient;
  storage: InMemoryStorage;
  http: () => ReturnType<typeof request>;
}

export interface CreateAppOptions {
  /** Overrides the register/login throttle limit (default comes from .env.test). */
  authThrottleLimit?: number;
}

/** Boots the full application exactly as main.ts does (prefix, pipes, filter, swagger). */
export async function createApp(opts: CreateAppOptions = {}): Promise<TestContext> {
  const storage = new InMemoryStorage();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue(storage);
  if (opts.authThrottleLimit !== undefined) {
    builder = builder.overrideProvider(getOptionsToken()).useValue({
      throttlers: [{ name: AUTH_THROTTLER, ttl: 60_000, limit: opts.authThrottleLimit }],
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, storage, http: () => request(app.getHttpServer()) };
}

/**
 * Removes all orders and carts, all non-admin users (cascades sessions/addresses), all shops and
 * every admin session. Order tables come first because their foreign keys are RESTRICT.
 */
export async function resetUsers(prisma: PrismaClient): Promise<void> {
  await prisma.subOrderStatusHistory.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.subOrder.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.listingPhoto.deleteMany({});
  await prisma.listing.deleteMany({});
  await prisma.vendorPayoutAccount.deleteMany({});
  await prisma.vendor.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.user.deleteMany({ where: { role: { not: 'ADMIN' } } });
}

const phoneBase = Math.floor(Math.random() * 900000);
let phoneSeq = 0;
/** A unique valid Tanzanian mobile number in local format, e.g. `0754123401`. */
export function uniquePhone(): string {
  phoneSeq += 1;
  return `0754${String((phoneBase + phoneSeq) % 1000000).padStart(6, '0')}`;
}

let emailSeq = 0;
export function uniqueEmail(): string {
  emailSeq += 1;
  return `user${Date.now()}${emailSeq}@example.co.tz`;
}

export const PASSWORD = 'Secret123';

export interface RegisteredUser {
  id: string;
  phone: string | null;
  email: string | null;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(
  ctx: TestContext,
  body: Partial<{ fullName: string; phone: string; email: string; password: string }> = {},
): Promise<RegisteredUser> {
  const payload = {
    fullName: 'Test User',
    phone: uniquePhone(),
    password: PASSWORD,
    ...body,
  };
  const res = await ctx.http().post(`${API}/auth/register`).send(payload).expect(201);
  return {
    id: res.body.user.id,
    phone: res.body.user.phone,
    email: res.body.user.email,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export async function loginAdmin(ctx: TestContext): Promise<{ id: string; accessToken: string }> {
  const res = await ctx
    .http()
    .post(`${API}/auth/login`)
    .send({ identifier: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
    .expect(200);
  return { id: res.body.user.id, accessToken: res.body.accessToken };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface VendorBody {
  shopName: string;
  description?: string;
  regionId: number;
  districtId: number;
  businessPhone: string;
  species: string[];
}

/** A valid application using a seeded region and one of its districts. */
export async function validVendorBody(
  prisma: PrismaClient,
  overrides: Partial<VendorBody> = {},
): Promise<VendorBody> {
  const district = await prisma.district.findFirstOrThrow({ orderBy: { id: 'asc' } });
  return {
    shopName: `Shop ${Date.now()} ${Math.floor(Math.random() * 1e6)}`,
    description: 'Healthy animals',
    regionId: district.regionId,
    districtId: district.id,
    businessPhone: uniquePhone(),
    species: ['CATTLE'],
    ...overrides,
  };
}

/** Applies for a shop as `token`'s user and returns the response body (asserts 201). */
export async function applyVendor(
  ctx: TestContext,
  token: string,
  overrides: Partial<VendorBody> = {},
): Promise<{ id: string; slug: string; status: string }> {
  const res = await ctx
    .http()
    .post(`${API}/vendors/me`)
    .set(bearer(token))
    .send(await validVendorBody(ctx.prisma, overrides))
    .expect(201);
  return res.body as { id: string; slug: string; status: string };
}

export async function approveVendor(
  ctx: TestContext,
  adminToken: string,
  vendorId: string,
): Promise<void> {
  await ctx
    .http()
    .post(`${API}/admin/vendors/${vendorId}/approve`)
    .set(bearer(adminToken))
    .expect(200);
}

/** Registers a customer, applies, and (optionally) gets the shop approved. */
export async function createVendor(
  ctx: TestContext,
  adminToken: string,
  opts: { approve?: boolean; overrides?: Partial<VendorBody> } = {},
): Promise<{ user: RegisteredUser; vendor: { id: string; slug: string; status: string } }> {
  const user = await registerUser(ctx);
  const vendor = await applyVendor(ctx, user.accessToken, opts.overrides);
  if (opts.approve) await approveVendor(ctx, adminToken, vendor.id);
  return { user, vendor };
}

/** Minimal buffers that pass magic-byte detection. */
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 2)]);

export interface ListingBody {
  title: string;
  description?: string;
  species: string;
  listingType: string;
  unit: string;
  unitPrice: number;
  stockQuantity: number;
  breed?: string | null;
  sex?: string | null;
  ageMonths?: number | null;
  weightKg?: number | null;
}

/** A valid LIVE_ANIMAL cattle listing (the shop must deal in CATTLE). */
export function validListingBody(overrides: Partial<ListingBody> = {}): ListingBody {
  return {
    title: 'Boran heifer',
    description: 'Healthy and vaccinated',
    species: 'CATTLE',
    listingType: 'LIVE_ANIMAL',
    unit: 'HEAD',
    unitPrice: 1200000,
    stockQuantity: 3,
    breed: 'Boran',
    sex: 'FEMALE',
    ageMonths: 30,
    ...overrides,
  };
}

type Json = any;

/** Creates a listing as `token`'s shop (asserts 201) and returns the owner view. */
export async function createListing(
  ctx: TestContext,
  token: string,
  overrides: Partial<ListingBody> = {},
): Promise<Json> {
  const res = await ctx
    .http()
    .post(`${API}/vendors/me/listings`)
    .set(bearer(token))
    .send(validListingBody(overrides))
    .expect(201);
  return res.body;
}

/** Publishes a listing (asserts 200) and returns the owner view. */
export async function publishListing(ctx: TestContext, token: string, id: string): Promise<Json> {
  const res = await ctx
    .http()
    .post(`${API}/vendors/me/listings/${id}/publish`)
    .set(bearer(token))
    .expect(200);
  return res.body;
}

// ------------------------------------------------------------------ Phase 4: cart & orders

/** Saves an address for `token`'s user in the first seeded district (asserts 201); returns its id. */
export async function createAddress(
  ctx: TestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const district = await ctx.prisma.district.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const res = await ctx
    .http()
    .post(`${API}/users/me/addresses`)
    .set(bearer(token))
    .send({
      label: 'Home',
      recipientName: 'Asha Mushi',
      contactPhone: uniquePhone(),
      regionId: district.regionId,
      districtId: district.id,
      wardStreet: 'Sakina, Mianzini Street',
      landmark: 'Near the market',
      ...overrides,
    })
    .expect(201);
  return res.body.id as string;
}

/** Adds `quantity` of a listing to `token`'s cart (asserts 200) and returns the cart. */
export async function addToCart(
  ctx: TestContext,
  token: string,
  listingId: string,
  quantity = 1,
): Promise<Json> {
  const res = await ctx
    .http()
    .post(`${API}/cart/items`)
    .set(bearer(token))
    .send({ listingId, quantity })
    .expect(200);
  return res.body;
}

export interface CheckoutLine {
  listingId: string;
  quantity: number;
  unitPrice: number;
}

/** The confirmable lines of `token`'s cart, as `GET /cart` shows them. */
export async function cartLines(ctx: TestContext, token: string): Promise<CheckoutLine[]> {
  const res = await ctx.http().get(`${API}/cart`).set(bearer(token)).expect(200);
  return (res.body.shops as Json[]).flatMap((shop) =>
    (shop.lines as Json[]).map((l) => ({
      listingId: l.listingId as string,
      quantity: l.quantity as number,
      unitPrice: (l.unitPrice ?? l.previousPrice ?? 1) as number,
    })),
  );
}

/**
 * Sends a checkout (no status assertion). Lines default to the cart as `GET /cart` shows it and
 * the submission key to a fresh random one.
 */
export async function checkout(
  ctx: TestContext,
  token: string,
  addressId: string,
  opts: { lines?: CheckoutLine[]; submissionKey?: string } = {},
): Promise<request.Response> {
  const lines = opts.lines ?? (await cartLines(ctx, token));
  return ctx
    .http()
    .post(`${API}/orders`)
    .set(bearer(token))
    .send({ addressId, submissionKey: opts.submissionKey ?? randomUUID(), lines });
}

/** Adds the given listings to the cart and checks out (asserts 201); returns the order. */
export async function placeOrder(
  ctx: TestContext,
  token: string,
  addressId: string,
  items: { listingId: string; quantity?: number }[],
): Promise<Json> {
  for (const item of items) await addToCart(ctx, token, item.listingId, item.quantity ?? 1);
  const res = await checkout(ctx, token, addressId);
  if (res.status !== 201) {
    throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** The listing's current stock straight from the database. */
export async function getStock(ctx: TestContext, listingId: string): Promise<number> {
  const l = await ctx.prisma.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: { stockQuantity: true },
  });
  return l.stockQuantity;
}
