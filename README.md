# Animal Husbandry Marketplace — Backend

Multi-vendor livestock & animal-products marketplace for Tanzania (TZS).
NestJS + Prisma + PostgreSQL, REST API under `/api/v1`, OpenAPI docs at `/docs`.

**Phase 1 (this release):** foundation, authentication (phone/email + password, JWT access tokens,
rotating refresh tokens), roles (CUSTOMER / VENDOR / ADMIN), user profiles, delivery addresses on
Tanzania regions/districts, and admin user management. See [`specs/001-foundation-auth`](specs/001-foundation-auth).

## Prerequisites

- Node.js 24 LTS, npm
- Docker with Compose

## Setup

```bash
cp .env.example .env              # then set JWT_ACCESS_SECRET and ADMIN_* values
docker compose up -d              # db (5434), db_test (5433), minio (9100/9101) + bucket init
npm install
npx prisma migrate deploy
npm run prisma:seed               # 31 regions + districts, admin from ADMIN_* env
npm run start:dev
```

- API: http://localhost:3000/api/v1
- Docs: http://localhost:3000/docs (JSON: `/docs-json`)
- Health: http://localhost:3000/api/v1/health

> The dev database is published on host port **5434** (not 5432) so it does not collide with a
> locally installed PostgreSQL. Change the port in `docker-compose.yml` and `DATABASE_URL` if needed.

Vendor logos go to S3-compatible object storage. Locally that is MinIO: API on host port **9100**,
console on **9101** (`minioadmin` / `minioadmin`). The one-shot `minio-init` service creates the
public-read `vendor-logos` bucket. E2E tests replace storage with an in-memory fake, so they do not
need MinIO.

## Commands

| Command | Purpose |
|---|---|
| `npm run start:dev` | Run with watch mode |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run lint` | ESLint (type-aware) + Prettier |
| `npm test` | Unit tests (Jest) |
| `npm run test:e2e` | E2E tests (supertest) against `db_test` on port 5433 |
| `npm run prisma:migrate` | Create/apply a migration in development |
| `npm run prisma:seed` | Seed regions/districts and the admin user (idempotent) |

E2E tests use `.env.test` (committed; contains no real secrets). The global setup applies migrations
and the seed to `db_test` and refuses to run against any other database.

## Configuration

All configuration comes from environment variables, validated at startup (the process exits naming
every missing/invalid key). See [`.env.example`](.env.example).

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | required |
| `JWT_ACCESS_SECRET` | — | required, ≥ 32 chars |
| `JWT_ACCESS_TTL` | `900` | seconds |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | |
| `BCRYPT_ROUNDS` | `10` | |
| `AUTH_THROTTLE_LIMIT` / `AUTH_THROTTLE_TTL_MS` | `10` / `60000` | register/login attempts per client |
| `LOG_LEVEL` | `info` | pino; secrets are redacted |
| `ADMIN_FULL_NAME`, `ADMIN_EMAIL`, `ADMIN_PHONE`, `ADMIN_PASSWORD` | — | used by the seed only |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | required; object storage for logos |
| `S3_PUBLIC_BASE_URL` | — | required; logo URLs are `<base>/<key>` |
| `S3_FORCE_PATH_STYLE` | `true` | keep `true` for MinIO |

## API overview

Errors always have the shape
`{ statusCode, error, message, path, timestamp }`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`; `GET /auth/me` |
| Profile | `GET` / `PATCH /users/me` |
| Regions | `GET /regions`, `GET /regions/:id/districts` (public) |
| Addresses | `GET` / `POST /users/me/addresses`, `GET` / `PATCH` / `DELETE /users/me/addresses/:id` |
| Admin | `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/status` |
| My shop | `POST` / `GET` / `PATCH /vendors/me`, `POST /vendors/me/resubmit`, `PUT` / `DELETE /vendors/me/logo`, `GET` / `PUT /vendors/me/payout-account` |
| Shops (public) | `GET /vendors?regionId&districtId&species&search`, `GET /vendors/:slug` |
| Admin shops | `GET /admin/vendors?status&search`, `GET /admin/vendors/:id`, `POST /admin/vendors/:id/approve` \| `reject` \| `suspend` \| `reactivate` |
| Health | `GET /health` (public) |

### Vendor lifecycle

```text
customer applies ──► PENDING ──approve──► APPROVED ◄──reactivate── SUSPENDED
                        │                     └──────suspend──────────►┘
                      reject (reason)
                        ▼
                     REJECTED ──owner edits + resubmits──► PENDING
```

- One shop per user; only customers can apply. Approval makes the owner a `VENDOR` immediately.
- The public only sees `APPROVED` shops whose owner account is active, and never payout details,
  rejection reasons or reviewer info.
- Logos: JPEG/PNG/WebP up to 2 MB, verified by content. Payout: `MOBILE_MONEY` (MPESA, MIXX_BY_YAS,
  AIRTEL_MONEY, HALOPESA) or `BANK`; the database rejects mixed fields.

Refresh tokens look like `<sessionId>.<secret>`, are single-use, and are stored only as SHA-256 hashes.
Presenting a token that was already used or revoked signs the user out everywhere.

## Project layout

```text
prisma/           schema, migrations, seed + Tanzania regions data
src/common/       decorators (@Public, @Roles, @CurrentUser), guards, error filter, validators, health
src/auth/         register/login/refresh/logout/change-password, sessions, JWT strategy
src/users/        profile, regions/districts, addresses
src/common/storage/  StorageService (abstract) + S3 implementation
src/vendors/      shop applications, public browsing, logo, payout account, admin review service
src/admin/        admin user and shop management controllers
test/             e2e specs and harness
```

Every non-public route must declare `@Roles(...)`; a route without it fails closed with a 500.
