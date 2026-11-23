import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
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

/** Removes all non-admin users (cascades sessions/addresses), all shops and every admin session. */
export async function resetUsers(prisma: PrismaClient): Promise<void> {
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
