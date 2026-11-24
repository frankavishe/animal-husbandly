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

Vendor logos and listing photos go to S3-compatible object storage. Locally that is MinIO: API on host
port **9100**, console on **9101** (`minioadmin` / `minioadmin`). The one-shot `minio-init` service
creates the public-read `vendor-logos` bucket, which also holds listing photos under
`listings/<listingId>/`. E2E tests replace storage with an in-memory fake, so they do not
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
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | required; object storage for logos and listing photos |
| `S3_PUBLIC_BASE_URL` | — | required; logo and photo URLs are `<base>/<key>` |
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
| My listings | `POST` / `GET /vendors/me/listings`, `GET` / `PATCH /vendors/me/listings/:id`, `POST /vendors/me/listings/:id/publish` \| `pause` \| `activate` \| `archive` |
| Listing photos | `POST /vendors/me/listings/:id/photos`, `DELETE /vendors/me/listings/:id/photos/:photoId`, `PUT /vendors/me/listings/:id/photos/order` |
| Listings (public) | `GET /listings?species&listingType&regionId&districtId&shop&minPrice&maxPrice&inStock&search&sort`, `GET /listings/:id` |
| Admin listings | `GET /admin/listings?status&vendorId&species&listingType`, `GET /admin/listings/:id`, `POST /admin/listings/:id/take-down` \| `restore` |
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

### Listings

```text
DRAFT ──publish──► ACTIVE ──pause──► INACTIVE
                     ▲                  │
                     └─────activate─────┘

DRAFT | ACTIVE | INACTIVE ──admin take-down (reason)──► TAKEN_DOWN ──admin restore──► INACTIVE
DRAFT | ACTIVE | INACTIVE | TAKEN_DOWN ──archive──► ARCHIVED (irreversible)
```

| Type | Species | Units | Live-animal fields |
|---|---|---|---|
| `LIVE_ANIMAL` | any | `HEAD`, `KG` | `breed`, `sex`, `ageMonths` required; `weightKg` optional |
| `MEAT` | any | `KG`, `PIECE` | refused |
| `MILK` | `CATTLE` only | `LITRE` | refused |
| `EGGS` | `CHICKEN` only | `PIECE`, `TRAY` (30 eggs) | refused |

- These rules are enforced in the service (400) and by database CHECK constraints.
- A listing's species must be one its shop deals in. Species and type can only change while `DRAFT`.
- Creating, editing, publishing, activating and photo changes need an `APPROVED` shop; pausing and
  archiving are always allowed.
- The public only sees `ACTIVE` listings of visible shops. Zero stock is shown as out of stock.
- Photos: up to 5 per listing, JPEG/PNG/WebP up to 5 MB each, verified by content; the first is the cover.

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
src/listings/     listing rules, vendor CRUD + lifecycle, photos, public browsing, admin moderation service
src/admin/        admin user, shop and listing management controllers
test/             e2e specs and harness
```

Every non-public route must declare `@Roles(...)`; a route without it fails closed with a 500.
