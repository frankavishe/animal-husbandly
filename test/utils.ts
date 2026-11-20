import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

export const API = '/api/v1';

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaClient;
  http: () => ReturnType<typeof request>;
}

/**
 * Boots the full application exactly as main.ts does (prefix, pipes, filter, swagger).
 * `env` overrides are applied before the app modules are loaded (isolated module registry), so
 * each call gets its own config — e.g. a low throttle limit.
 */
export async function createApp(env: Record<string, string> = {}): Promise<TestContext> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  let AppModule: any;
  let configureApp: any;
  let PrismaService: any;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    AppModule = require('../src/app.module').AppModule;
    configureApp = require('../src/app.setup').configureApp;
    PrismaService = require('../src/prisma/prisma.service').PrismaService;
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();
  process.env = saved;
  const prisma = app.get<PrismaClient>(PrismaService);
  return { app, prisma, http: () => request(app.getHttpServer()) };
}

/** Removes all non-admin users (cascades sessions/addresses) and every admin session. */
export async function resetUsers(prisma: PrismaClient): Promise<void> {
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
  const res = await ctx
    .http()
    .post(`${API}/auth/register`)
    .send(payload)
    .expect(201);
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
