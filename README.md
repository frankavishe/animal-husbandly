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
docker compose up -d              # db (host port 5434) + db_test (host port 5433)
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
| Health | `GET /health` (public) |

Refresh tokens look like `<sessionId>.<secret>`, are single-use, and are stored only as SHA-256 hashes.
Presenting a token that was already used or revoked signs the user out everywhere.

## Project layout

```text
prisma/           schema, migrations, seed + Tanzania regions data
src/common/       decorators (@Public, @Roles, @CurrentUser), guards, error filter, validators, health
src/auth/         register/login/refresh/logout/change-password, sessions, JWT strategy
src/users/        profile, regions/districts, addresses
src/admin/        admin user management
test/             e2e specs and harness
```

Every non-public route must declare `@Roles(...)`; a route without it fails closed with a 500.
