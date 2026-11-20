# Implementation Plan: Foundation, Authentication & Users

**Branch**: `001-foundation-auth` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-foundation-auth/spec.md`

## Summary

Bootstrap the Animal Husbandry Marketplace backend: a NestJS + Prisma + PostgreSQL service exposing a
versioned REST API (`/api/v1`) with validated configuration, global request validation, one error shape,
Swagger docs at `/docs` and a health check. On top of it: registration/sign-in by Tanzanian phone or
email, 15-minute JWT access tokens plus rotating, hashed, single-use refresh tokens with replay detection,
role-based access (CUSTOMER/VENDOR/ADMIN), user profiles, delivery addresses on seeded Tanzania
regions/districts, and admin user management (list/search/activate/deactivate).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 24 LTS

**Primary Dependencies**: NestJS (latest stable), Prisma ORM, `@nestjs/config` + Joi, `@nestjs/swagger`,
`class-validator`/`class-transformer`, `@nestjs/jwt` + `passport-jwt`, `bcrypt`, `@nestjs/throttler`,
`@nestjs/terminus`, `libphonenumber-js`, `nestjs-pino`

**Storage**: PostgreSQL 16 via `docker compose` (dev on host port 5434, test on 5433)

**Testing**: Jest (unit), Jest + supertest (e2e against the Dockerized test DB)

**Target Platform**: Linux/Windows server, container-friendly

**Project Type**: web-service (backend only)

**Performance Goals**: p95 < 1 s for sign-in, profile and address operations at 100 concurrent users (SC-007)

**Constraints**: access token 15 min, refresh 7 days; 10 auth attempts/min/client; pagination default 20, max 100

**Scale/Scope**: Phase 1 of a multi-phase marketplace; ~17 endpoints, 5 tables

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Modular NestJS | PASS | Modules `prisma`, `common`, `auth`, `users`, `admin`. Regions/districts live in `users` (read-only lookup) to stay inside the constitution's module list. Health check is part of `common`. One raw-SQL partial index in a migration (see Complexity Tracking). |
| II. Domain Integrity | N/A | No species/listings in this phase. |
| III. Money Safety | N/A | No money in this phase. Multi-row writes (refresh rotation, default-address switch) still use transactions. |
| IV. API Contract First | PASS | `/api/v1` prefix, Swagger at `/docs`, DTO validation with whitelist/forbidNonWhitelisted/transform, global exception filter with `{statusCode,error,message,path,timestamp}`, paginated admin list. |
| V. Security by Default | PASS | bcrypt passwords; JWT access + hashed rotating refresh tokens; `@Roles` on every non-public route via global guards (`@Public` opt-out); secrets from env validated at startup; `.env.example` committed, `.env` ignored. Webhooks N/A. |
| VI. Test Discipline | PASS | Unit tests for services; e2e per endpoint group against Dockerized Postgres. |
| VII. Phased Delivery | PASS | Only Phase 1 scope; no vendor/listing/payment code. |

Post-design re-check: PASS (no new violations).

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation-auth/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md
```

### Source Code (repository root)

```text
docker-compose.yml
.env.example
prisma/
├── schema.prisma
├── migrations/
├── data/tz-regions.ts
└── seed.ts
src/
├── main.ts                     # bootstrap: prefix, pipes, filter, swagger
├── app.module.ts
├── config/env.validation.ts
├── prisma/                     # PrismaModule + PrismaService
├── common/
│   ├── decorators/             # @Public, @Roles, @CurrentUser
│   ├── guards/                 # JwtAuthGuard, RolesGuard (global)
│   ├── filters/                # AllExceptionsFilter
│   ├── dto/pagination.dto.ts
│   ├── utils/phone.ts          # TZ phone normalisation
│   └── health/                 # HealthController
├── auth/                       # register, login, refresh, logout, change-password, me
├── users/                      # profile, addresses, regions/districts
└── admin/                      # admin user management
test/
├── jest-e2e.json
├── setup-e2e.ts
└── *.e2e-spec.ts
```

**Structure Decision**: Single NestJS project at the repository root; unit tests are colocated
`*.spec.ts`, e2e tests in `test/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Raw SQL in a Prisma migration: partial unique index `addresses(user_id) WHERE is_default` | Guarantees at most one default address per user at the DB level (FR-023) | Prisma schema cannot express partial indexes; service-only checks race under concurrency |
