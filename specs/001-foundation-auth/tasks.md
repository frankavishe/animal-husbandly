# Tasks: Foundation, Authentication & Users

**Input**: Design documents from `/specs/001-foundation-auth/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

Format: `[ID] [P?] [Story] Description` — `[P]` = parallelisable (different files, no dependency).

## Phase 1: Setup

- [X] T001 Initialise npm project with NestJS, Prisma and tooling deps in `package.json`; scripts `build`, `start`, `start:dev`, `lint`, `test`, `test:e2e`, `prisma:seed`
- [X] T002 [P] TypeScript strict config in `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`
- [X] T003 [P] ESLint + Prettier config in `eslint.config.mjs`, `.prettierrc`
- [X] T004 [P] `docker-compose.yml` with `db` (host 5434, avoids a local PostgreSQL on 5432) and `db_test` (5433) PostgreSQL 16
- [X] T005 [P] `.env.example`, `.gitignore` (node_modules, dist, .env, coverage)

## Phase 2: Foundational (blocks all stories)

- [X] T006 Prisma schema (User, Session, Region, District, Address, Role) in `prisma/schema.prisma`
- [X] T007 Initial migration incl. CHECK (phone or email) and partial unique default-address index in `prisma/migrations/`
- [X] T008 [P] Tanzania regions/districts data in `prisma/data/tz-regions.ts`
- [X] T009 Seed script (regions, districts, admin from env) in `prisma/seed.ts`
- [X] T010 [P] Env validation schema in `src/config/env.validation.ts`
- [X] T011 [P] `PrismaModule`/`PrismaService` in `src/prisma/`
- [X] T012 [P] `AllExceptionsFilter` (consistent error shape, Prisma P2002→409, P2025→404) in `src/common/filters/`
- [X] T013 [P] Decorators `@Public`, `@Roles`, `@CurrentUser` in `src/common/decorators/`
- [X] T014 [P] Pagination DTO + helper in `src/common/dto/pagination.dto.ts`
- [X] T015 [P] TZ phone normalisation util + unit tests in `src/common/utils/phone.ts`
- [X] T016 `JwtAuthGuard` + `RolesGuard` registered globally in `src/common/guards/`
- [X] T017 App bootstrap (prefix `/api/v1`, ValidationPipe, filter, Swagger `/docs`, pino logger) in `src/main.ts`, `src/app.module.ts`
- [X] T018 E2E harness (`test/jest-e2e.json`, `test/global-setup.ts`, `test/utils.ts`) against `db_test`

## Phase 3: User Story 4 — Operable foundation (P1)

- [X] T019 [US4] Health check with Prisma indicator in `src/common/health/`
- [X] T020 [US4] E2E: health up, validation error shape, unknown fields rejected, `/docs-json` lists routes in `test/foundation.e2e-spec.ts`
- [X] T021 [US4] Unit test: env validation rejects missing secret in `src/config/env.validation.spec.ts`

## Phase 4: User Story 1 — Account & sign-in (P1)

- [X] T022 [P] [US1] Auth DTOs (register, login, refresh, change-password, responses) in `src/auth/dto/`
- [X] T023 [US1] `UsersService` core (create, findByIdentifier, findById, toPublic) in `src/users/users.service.ts`
- [X] T024 [US1] `SessionsService` (create, rotate with replay detection, revoke, revokeAll) in `src/auth/sessions.service.ts`
- [X] T025 [US1] `AuthService` (register, login, refresh, logout, changePassword) in `src/auth/auth.service.ts`
- [X] T026 [US1] `JwtStrategy` rejecting inactive users in `src/auth/jwt.strategy.ts`
- [X] T027 [US1] `AuthController` with throttling + Swagger in `src/auth/auth.controller.ts`
- [X] T028 [P] [US1] Unit tests for `AuthService` and `SessionsService`
- [X] T029 [US1] E2E auth flows (register/login/refresh/replay/logout/duplicates/generic error/throttle) in `test/auth.e2e-spec.ts`

## Phase 5: User Story 2 — Profile & addresses (P2)

- [X] T030 [P] [US2] Profile DTO + `GET/PATCH /users/me` in `src/users/users.controller.ts`
- [X] T031 [P] [US2] Regions/districts service + controller in `src/users/regions.*`
- [X] T032 [US2] `AddressesService` (ownership, region/district check, default handling) in `src/users/addresses.service.ts`
- [X] T033 [US2] `AddressesController` in `src/users/addresses.controller.ts`
- [X] T034 [P] [US2] Unit tests for `AddressesService` and profile update rules
- [X] T035 [US2] E2E profile, change-password, regions, addresses in `test/users.e2e-spec.ts`

## Phase 6: User Story 3 — Admin (P3)

- [X] T036 [US3] `AdminUsersService` (list/filter/search, get, set status + revoke) in `src/admin/`
- [X] T037 [US3] `AdminUsersController` (ADMIN only) in `src/admin/admin-users.controller.ts`
- [X] T038 [P] [US3] Unit tests for admin service
- [X] T039 [US3] E2E admin flows (403 for customer, deactivate blocks, self-deactivate refused) in `test/admin.e2e-spec.ts`

## Phase 7: Polish

- [X] T040 [P] `README.md` with setup and commands
- [X] T041 Quality gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` all green

## Dependencies
Setup → Foundational → US4 → US1 → US2 / US3 (US2 and US3 independent after US1).
