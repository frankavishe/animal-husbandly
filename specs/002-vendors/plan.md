# Implementation Plan: Vendors

**Branch**: `002-vendors` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-vendors/spec.md`

## Summary

Add vendor shops to the marketplace. A CUSTOMER applies for one shop (name, description, region/district,
business phone, species). The shop starts PENDING. An ADMIN approves it, which in the same transaction
promotes the owner to VENDOR, or rejects it with a reason, and later can suspend or reactivate it.
Approved shops of active owners are browsable publicly by slug, region, district, species and name.
Owners upload a logo, which is checked by magic bytes and stored in S3-compatible object storage (MinIO
locally). They also record one payout account, either mobile money or bank; a DB CHECK enforces that the
fields match the method. No money moves.

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 24 LTS

**Primary Dependencies**: Existing Phase 1 stack (NestJS 11, Prisma 6, class-validator, @nestjs/swagger,
libphonenumber-js), plus `@aws-sdk/client-s3` (S3 API, used against MinIO) and multer via
`@nestjs/platform-express` with `@types/multer` for multipart uploads.

**Storage**: PostgreSQL 16 (2 new tables, 4 new enums); object storage is S3-compatible, using MinIO in
docker-compose (host ports 9100 API and 9101 console).

**Testing**: Jest unit tests with mocked Prisma and storage. Jest + supertest e2e against `db_test`, with
`StorageService` overridden by an in-memory fake.

**Target Platform**: Linux/Windows server, container-friendly

**Project Type**: web-service (backend only)

**Performance Goals**: p95 < 1 s for the public shop list and shop page at 100 concurrent users (SC-006).
Indexes on `vendors(status)`, `vendors(region_id)`, and a GIN index on `species`.

**Constraints**: Logo ≤ 2 MB, JPEG/PNG/WebP by content. Pagination default 20, max 100. Payout fields must
match the method at both the DTO and DB level.

**Scale/Scope**: About 15 new endpoints, 2 tables, 1 migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Modular NestJS | PASS | New `vendors` module (in the constitution's list). Admin endpoints go in the existing `admin` module through the exported `VendorsService`/`VendorsAdminService`, with no cross-module table access from controllers. Object storage is shared infrastructure in `common/storage` (a global `StorageModule`). `UsersModule` exports `RegionsService` for region/district checks. Raw SQL is used only in the migration (CHECK constraints, GIN index); see Complexity Tracking. |
| II. Domain Integrity | PASS | Adds the `Species` enum with exactly the six constitutional values; no listing types or species-type rules yet (listings phase). |
| III. Money Safety | PASS / N/A | No money moves. Payout account data is not a monetary record. Approve plus the role change run in one transaction. |
| IV. API Contract First | PASS | All routes under `/api/v1`, Swagger decorators (multipart via `@ApiConsumes`), whitelisting DTOs, the existing error shape, and paginated lists. |
| V. Security by Default | PASS | Every route declares `@Roles` or `@Public`. Owners act only on their own shop (resolved from the JWT user, never from a path id). Payout data is returned only to the owner and admins. S3 credentials come from env and are validated by Joi. Uploads are capped at 2 MB with content sniffing. |
| VI. Test Discipline | PASS | Unit tests for the vendor, admin-vendor, payout and image-sniffing logic; e2e for the owner, public and admin endpoint groups. Species validation has passing and failing cases. |
| VII. Phased Delivery | PASS | Payout account and logo storage are in scope because the owner explicitly requested them for this phase. No payout execution, commission or listing code. Storage is introduced with an interface because this is the phase that needs it. |

Post-design re-check: PASS (no new violations beyond Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/002-vendors/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
docker-compose.yml                  # + minio, minio-init
.env.example / .env.test            # + S3_* keys
prisma/
├── schema.prisma                   # + VendorStatus, Species, PayoutMethod, MobileMoneyProvider, Vendor, VendorPayoutAccount
└── migrations/<ts>_vendors/        # + CHECK constraints, GIN index
src/
├── config/env.validation.ts        # + S3_* validation
├── common/
│   ├── storage/                    # StorageService (abstract), S3StorageService, StorageModule
│   └── utils/image.ts (+ .spec)    # detectImageType(buffer) by magic bytes
├── users/users.module.ts           # export RegionsService
├── vendors/
│   ├── vendors.module.ts
│   ├── dto/                        # apply/update, public & owner responses, list query, payout DTOs
│   ├── slug.ts (+ .spec)           # slugify
│   ├── vendors.service.ts (+ .spec)        # apply, getMine, updateMine, resubmit, public list/get, logo
│   ├── payout-accounts.service.ts (+ .spec)
│   ├── vendors-admin.service.ts (+ .spec)  # list/get/approve/reject/suspend/reactivate
│   ├── vendors.controller.ts       # /vendors/me/*
│   └── public-vendors.controller.ts# /vendors, /vendors/:slug
├── admin/
│   ├── admin-vendors.controller.ts # /admin/vendors/*
│   └── admin.module.ts             # imports VendorsModule
└── app.module.ts                   # + StorageModule, VendorsModule
test/
├── utils.ts                        # + InMemoryStorage override, createVendor helper
├── vendors.e2e-spec.ts             # owner + public
└── admin-vendors.e2e-spec.ts
```

**Structure Decision**: Same single NestJS project. The admin vendor logic lives in the `vendors` module
(`VendorsAdminService`, exported) so that the `admin` module only hosts the controller and does not touch
vendor tables itself (Principle I).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Raw SQL CHECK constraints in the migration (`vendor_payout_accounts` method/field consistency; `cardinality(species) >= 1` on `vendors`) | FR-025 requires storage-level enforcement of payout field rules; FR-001 requires at least one species | Prisma schema cannot express CHECK constraints; DTO checks alone can be bypassed by other code paths |
| Raw SQL GIN index on `vendors(species)` | Efficient `species has X` filtering for public browsing (SC-006) | Prisma `@@index` on an enum array creates a B-tree, which does not serve `@>` queries |
| `common/storage` module not in the constitution's module list | Object storage is cross-cutting (logos now, listing images next phase) | Putting it in `vendors` would force listings to reach into the vendors module |
