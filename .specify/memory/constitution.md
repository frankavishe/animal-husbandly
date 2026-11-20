<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: all placeholders replaced (initial ratification)
- Added principles: I. Modular NestJS Architecture; II. Domain Integrity (NON-NEGOTIABLE);
  III. Money Safety; IV. API Contract First; V. Security by Default;
  VI. Test Discipline (NON-NEGOTIABLE); VII. Phased Delivery & Simplicity
- Added sections: Technology & Platform Constraints; Development Workflow & Quality Gates
- Removed sections: none
- Templates: plan/spec/tasks templates read this file at runtime; no template edits required
- Deferred TODOs: none
-->

# Animal Husbandry Marketplace Constitution

## Core Principles

### I. Modular NestJS Architecture

The backend is a NestJS application written in TypeScript with `strict` mode enabled.

- Each bounded context MUST live in its own NestJS module: `auth`, `users`, `vendors`,
  `listings`, `cart`, `orders`, `payments`, `payouts`, `delivery`, `reviews`,
  `notifications`, `admin` (plus shared `common` and `prisma` modules).
- Modules MUST interact through exported services, never by reaching into another
  module's internals or tables directly from controllers.
- Prisma is the ONLY database access layer; raw SQL is allowed only inside Prisma
  migrations or `$queryRaw` with parameter binding, and MUST be justified in the plan.

Rationale: clear module boundaries keep a multi-vendor marketplace maintainable as
phases add cart, payments, payouts and delivery.

### II. Domain Integrity (NON-NEGOTIABLE)

- Supported species: `CATTLE`, `GOAT`, `SHEEP`, `PIG`, `CHICKEN`, `FISH`.
- Supported listing types: `LIVE_ANIMAL`, `MEAT`, `MILK`, `EGGS`.
- `LIVE_ANIMAL` and `MEAT` are allowed for every species.
- `MILK` is allowed ONLY for `CATTLE`. Goat, sheep and pig milk MUST NOT be listable.
- `EGGS` are allowed ONLY for `CHICKEN`.
- These rules MUST be enforced in BOTH the service layer (returning HTTP 400 with a clear
  message) AND the database (constraint or rule table), so no code path can bypass them.
- Every new species or listing type requires a constitution amendment.

Rationale: the business sells a fixed catalogue; invalid products must be impossible,
not merely discouraged.

### III. Money Safety

- All monetary amounts MUST be stored and computed as integer Tanzanian Shillings (TZS);
  floating-point types MUST NOT be used for money in code or schema.
- Any operation that changes money or stock (checkout, payment confirmation, commission,
  payout, refund) MUST run inside a single database transaction.
- Monetary records (payments, ledger entries, payouts) are append-only; corrections are
  made with new compensating entries, never by editing history.

Rationale: vendors are paid from platform balances; rounding errors or partial writes
directly cost real people money.

### IV. API Contract First

- The API is REST/JSON, versioned under `/api/v1`.
- Every endpoint MUST be documented in OpenAPI via `@nestjs/swagger` decorators and be
  visible at `/docs`.
- Every request body and query MUST be validated by DTOs using `class-validator`, with a
  global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`).
- Errors MUST use one consistent shape: `{ statusCode, error, message, path, timestamp }`.
- List endpoints MUST be paginated.

Rationale: a backend-only project is consumed by future web/mobile clients; the contract
is the product.

### V. Security by Default

- Passwords MUST be hashed with bcrypt; plaintext passwords MUST never be logged or stored.
- Authentication uses JWT access tokens (short-lived) plus refresh tokens (rotated, stored
  hashed, revocable).
- Authorization is role-based: `CUSTOMER`, `VENDOR`, `ADMIN`; every non-public endpoint
  MUST declare its allowed roles, and vendors MUST only modify their own resources.
- Secrets MUST come only from environment variables (`.env`, never committed;
  `.env.example` documents keys) and be validated at startup.
- Payment webhooks MUST verify the provider signature and be idempotent.

Rationale: the platform handles personal data, mobile-money numbers and payments.

### VI. Test Discipline (NON-NEGOTIABLE)

- Service logic MUST have unit tests (Jest).
- Each endpoint group MUST have e2e tests (supertest) running against a Dockerized
  PostgreSQL test database.
- Domain rules from Principle II MUST have explicit passing and failing test cases.
- A phase is complete only when `npm run lint`, `npm run build`, `npm test` and
  `npm run test:e2e` all pass.

Rationale: tests are the evidence that each phase actually works before the next begins.

### VII. Phased Delivery & Simplicity

- Work is delivered in phases; each phase is exactly one Spec Kit feature following
  specify → clarify → plan → tasks → implement.
- The owner reviews and approves each phase before the next phase starts.
- Build only what the current phase's spec requires; no speculative abstractions,
  unused modules or "future-proof" layers (YAGNI). Integration seams (e.g. a payment
  provider interface) are introduced only in the phase that needs them.

Rationale: small reviewed increments keep scope under control and quality visible.

## Technology & Platform Constraints

- Runtime: Node.js LTS (24.x), NestJS (latest stable), TypeScript strict.
- Database: PostgreSQL 16 run via `docker compose`; schema managed only by Prisma migrations;
  seed data via `prisma/seed.ts` (species/type rules, Tanzania regions).
- Market: Tanzania; currency TZS; phone numbers validated in E.164 `+255` format.
- Payments (from the payments phase): mobile money (M-Pesa, Mixx by Yas/Tigo Pesa,
  Airtel Money, HaloPesa) and card through a Tanzanian aggregator, plus cash on delivery.
- Marketplace model: multi-vendor; one customer order splits into per-vendor sub-orders;
  the platform earns a configurable commission.
- Configuration via `@nestjs/config` with schema validation; logging is structured.

## Development Workflow & Quality Gates

- Each phase lives in `specs/NNN-<name>/` with `spec.md`, `plan.md`, `data-model.md`,
  `contracts/` and `tasks.md`.
- Every `plan.md` MUST include a Constitution Check against Principles I–VII; any violation
  MUST be listed with justification in the plan's complexity tracking.
- Database changes ship as named Prisma migrations committed with the code.
- Commits are small and descriptive; nothing containing secrets is committed.
- Quality gate before phase sign-off: lint, build, unit and e2e tests green; Swagger
  reflects all new endpoints; owner review completed.

## Governance

- This constitution supersedes other practices for this project. Conflicts are resolved in
  its favour.
- Amendments require: a written change to this file, a version bump, a Sync Impact Report,
  and owner approval.
- Versioning: MAJOR for removing/redefining principles, MINOR for new principles or
  materially expanded guidance, PATCH for clarifications.
- Compliance is checked at every `/speckit-plan` (Constitution Check) and at phase sign-off
  review.

**Version**: 1.0.0 | **Ratified**: 2026-11-20 | **Last Amended**: 2026-11-20
