# Tasks: Foundation, Authentication & Users

**Input**: Design documents from `/specs/001-foundation-auth/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

Format: `[ID] [P?] [Story] Description` — `[P]` = parallelisable (different files, no dependency).

## Phase 1: Setup

- [ ] T001 Initialise npm project with NestJS, Prisma and tooling deps in `package.json`; scripts `build`, `start`, `start:dev`, `lint`, `test`, `test:e2e`, `prisma:seed`
- [ ] T002 [P] TypeScript strict config in `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`
- [ ] T003 [P] ESLint + Prettier config in `eslint.config.mjs`, `.prettierrc`
- [ ] T004 [P] `docker-compose.yml` with `db` (5432) and `db_test` (5433) PostgreSQL 16
- [ ] T005 [P] `.env.example`, `.gitignore` (node_modules, dist, .env, coverage)

## Phase 2: Foundational (blocks all stories)

- [ ] T006 Prisma schema (User, Session, Region, District, Address, Role) in `prisma/schema.prisma`
- [ ] T007 Initial migration incl. CHECK (phone or email) and partial unique default-address index in `prisma/migrations/`
- [ ] T008 [P] Tanzania regions/districts data in `prisma/data/tz-regions.ts`
- [ ] T009 Seed script (regions, districts, admin from env) in `prisma/seed.ts`
- [ ] T010 [P] Env validation schema in `src/config/env.validation.ts`
- [ ] T011 [P] `PrismaModule`/`PrismaService` in `src/prisma/`
- [ ] T012 [P] `AllExceptionsFilter` (consistent error shape, Prisma P2002→409, P2025→404) in `src/common/filters/`
- [ ] T013 [P] Decorators `@Public`, `@Roles`, `@CurrentUser` in `src/common/decorators/`
- [ ] T014 [P] Pagination DTO + helper in `src/common/dto/pagination.dto.ts`
- [ ] T015 [P] TZ phone normalisation util + unit tests in `src/common/utils/phone.ts`
- [ ] T016 `JwtAuthGuard` + `RolesGuard` registered globally in `src/common/guards/`
- [ ] T017 App bootstrap (prefix `/api/v1`, ValidationPipe, filter, Swagger `/docs`, pino logger) in `src/main.ts`, `src/app.module.ts`
- [ ] T018 E2E harness (`test/jest-e2e.json`, `test/global-setup.ts`, `test/utils.ts`) against `db_test`

## Phase 3: User Story 4 — Operable foundation (P1)

- [ ] T019 [US4] Health check with Prisma indicator in `src/common/health/`
- [ ] T020 [US4] E2E: health up, validation error shape, unknown fields rejected, `/docs-json` lists routes in `test/foundation.e2e-spec.ts`
- [ ] T021 [US4] Unit test: env validation rejects missing secret in `src/config/env.validation.spec.ts`

## Phase 4: User Story 1 — Account & sign-in (P1)

- [ ] T022 [P] [US1] Auth DTOs (register, login, refresh, change-password, responses) in `src/auth/dto/`
- [ ] T023 [US1] `UsersService` core (create, findByIdentifier, findById, toPublic) in `src/users/users.service.ts`
- [ ] T024 [US1] `SessionsService` (create, rotate with replay detection, revoke, revokeAll) in `src/auth/sessions.service.ts`
- [ ] T025 [US1] `AuthService` (register, login, refresh, logout, changePassword) in `src/auth/auth.service.ts`
- [ ] T026 [US1] `JwtStrategy` rejecting inactive users in `src/auth/jwt.strategy.ts`
- [ ] T027 [US1] `AuthController` with throttling + Swagger in `src/auth/auth.controller.ts`
- [ ] T028 [P] [US1] Unit tests for `AuthService` and `SessionsService`
- [ ] T029 [US1] E2E auth flows (register/login/refresh/replay/logout/duplicates/generic error/throttle) in `test/auth.e2e-spec.ts`

## Phase 5: User Story 2 — Profile & addresses (P2)

- [ ] T030 [P] [US2] Profile DTO + `GET/PATCH /users/me` in `src/users/users.controller.ts`
- [ ] T031 [P] [US2] Regions/districts service + controller in `src/users/regions.*`
- [ ] T032 [US2] `AddressesService` (ownership, region/district check, default handling) in `src/users/addresses.service.ts`
- [ ] T033 [US2] `AddressesController` in `src/users/addresses.controller.ts`
- [ ] T034 [P] [US2] Unit tests for `AddressesService` and profile update rules
- [ ] T035 [US2] E2E profile, change-password, regions, addresses in `test/users.e2e-spec.ts`

## Phase 6: User Story 3 — Admin (P3)

- [ ] T036 [US3] `AdminUsersService` (list/filter/search, get, set status + revoke) in `src/admin/`
- [ ] T037 [US3] `AdminUsersController` (ADMIN only) in `src/admin/admin-users.controller.ts`
- [ ] T038 [P] [US3] Unit tests for admin service
- [ ] T039 [US3] E2E admin flows (403 for customer, deactivate blocks, self-deactivate refused) in `test/admin.e2e-spec.ts`

## Phase 7: Polish

- [ ] T040 [P] `README.md` with setup and commands
- [ ] T041 Quality gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` all green

## Dependencies
Setup → Foundational → US4 → US1 → US2 / US3 (US2 and US3 independent after US1).
