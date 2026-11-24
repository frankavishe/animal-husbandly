# Implementation Plan: Listings

**Branch**: `003-listings` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-listings/spec.md`

## Summary

Add product listings to the marketplace. A VENDOR with an APPROVED shop creates listings (title, description,
species, listing type, unit, whole-TZS unit price, stock, and for live animals breed/sex/age/optional weight).
The constitution's species/type rules (milk only from cattle, eggs only from chickens) plus unit-per-type and
live-animal field rules are enforced twice: in a pure rules module that returns HTTP 400, and by CHECK
constraints in the database. Listings move DRAFT → ACTIVE ⇄ INACTIVE → ARCHIVED under vendor control; an
ADMIN can take one down (TAKEN_DOWN, with reason) and restore it to INACTIVE. ACTIVE listings of approved
shops with active owners are browsable publicly with filters, search and sorting. Vendors attach up to 5
photos (JPEG/PNG/WebP by content, ≤ 5 MB) stored in the existing object storage and can reorder them.
No cart, orders or stock decrement.

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 24 LTS

**Primary Dependencies**: Existing stack only (NestJS 11, Prisma 6, class-validator, @nestjs/swagger,
`@aws-sdk/client-s3`, multer). No new dependencies.

**Storage**: PostgreSQL 16 (2 new tables, 4 new enums, raw CHECK constraints); photos in the existing
S3-compatible storage (MinIO locally on 9100/9101) under `listings/{listingId}/`.

**Testing**: Jest unit tests with mocked Prisma/storage (rules module tested exhaustively for all 24
species×type combinations). Jest + supertest e2e against `db_test` with the in-memory `StorageService` fake,
plus a raw-SQL insert test proving the database itself rejects disallowed combinations.

**Target Platform**: Linux/Windows server, container-friendly

**Project Type**: web-service (backend only)

**Performance Goals**: p95 < 1 s for public listing search and listing detail at 100 concurrent users with
10,000 listings (SC-006). Indexes on `listings(status, published_at)`, `(vendor_id, status)`, `species`,
`listing_type`, `unit_price`.

**Constraints**: Price 1–1,000,000,000 TZS (int), stock 0–1,000,000 (int), weight 0.1–2000 kg as
`Decimal(5,1)`, ≤ 5 photos of ≤ 5 MB each. Pagination default 20, max 100.

**Scale/Scope**: 17 new endpoints (11 vendor, 2 public, 4 admin), 2 tables, 1 migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Modular NestJS | PASS | New `listings` module (in the constitution's list). It reads shops only through the exported `VendorsService.findMine` and the exported `PUBLIC_VENDOR_WHERE` filter (used as a Prisma relation filter in listing queries). Admin endpoints live in the `admin` module and call the exported `ListingsAdminService`. Raw SQL only in the migration (see Complexity Tracking). |
| II. Domain Integrity | PASS | `ListingType` enum has exactly the four constitutional values. Allowed combinations enforced in `listing-rules.ts` (400 with a clear message) and by CHECK `listings_species_type` in the DB. Unit tests cover every combination; an e2e test inserts goat MILK via raw SQL and expects a constraint violation. |
| III. Money Safety | PASS | `unit_price` is an integer TZS column; no floats for money (`weight_kg` is a non-monetary exact decimal). No money or stock-changing operations in this phase. |
| IV. API Contract First | PASS | All routes under `/api/v1` with Swagger decorators (multipart via `@ApiConsumes`), whitelisting DTOs, the existing error shape, paginated lists. |
| V. Security by Default | PASS | Every route declares `@Roles` or `@Public`. Vendors act only on listings of their own shop (resolved from the JWT user; foreign ids → 404). Public responses expose no payout, owner or moderation data. Uploads capped at 5 MB with magic-byte checks. |
| VI. Test Discipline | PASS | Unit tests for rules, listings, photos and admin services; e2e for vendor, public, photo and admin endpoint groups; Principle II rules have explicit passing and failing cases at service and DB level. |
| VII. Phased Delivery | PASS | Only what the spec requires: no cart, reservations, reviews or promotions. The upload interceptor is generalised only because a second consumer (photos) now exists. |

Post-design re-check: PASS (no new violations beyond Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/003-listings/
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
prisma/
├── schema.prisma                        # + ListingType, ListingUnit, ListingStatus, AnimalSex, Listing, ListingPhoto
└── migrations/<ts>_listings/            # + CHECK constraints
src/
├── common/upload/image-upload.interceptor.ts   # factory (maxBytes, label); replaces vendors/logo-upload.interceptor.ts
├── vendors/
│   ├── vendors.service.ts               # export PUBLIC_VENDOR_WHERE
│   └── vendors.controller.ts            # use the generalised interceptor (2 MB)
├── listings/
│   ├── listings.module.ts               # imports VendorsModule; exports ListingsAdminService
│   ├── listing-rules.ts (+ .spec)       # ALLOWED_UNITS, isAllowedCombination, validateListing
│   ├── listing.mapper.ts (+ .spec)      # public / owner / admin shapes
│   ├── dto/                             # create/update, list queries, responses, reorder, take-down
│   ├── listings.service.ts (+ .spec)    # vendor CRUD, transitions, public list/get
│   ├── listing-photos.service.ts (+ .spec)
│   ├── listings-admin.service.ts (+ .spec)
│   ├── vendor-listings.controller.ts    # /vendors/me/listings/*
│   └── public-listings.controller.ts    # /listings, /listings/:id
├── admin/
│   ├── admin-listings.controller.ts     # /admin/listings/*
│   └── admin.module.ts                  # imports ListingsModule
└── app.module.ts                        # + ListingsModule
test/
├── utils.ts                             # + validListingBody, createListing, publishListing helpers
├── listings.e2e-spec.ts                 # vendor + public + DB-level rule test
├── listing-photos.e2e-spec.ts
└── admin-listings.e2e-spec.ts
```

**Structure Decision**: Same single NestJS project. Admin listing logic lives in the `listings` module
(`ListingsAdminService`, exported) so the `admin` module only hosts the controller (Principle I), matching
Phase 2. Vendor routes are nested under `/vendors/me/listings` for consistency with the other owner
resources, but are served by the `listings` module's controller.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Raw SQL CHECK constraints in the migration (species/type, unit/type, live-animal fields, numeric ranges, photo position) | Principle II requires DB-level enforcement; FR-003/005/006/007 | Prisma schema cannot express CHECK constraints; service checks alone can be bypassed |
| Moving the logo interceptor to `common/upload` | Photos need the same multipart + size-limit behaviour with a different limit | Copying it into `listings` would duplicate code; importing it from `vendors` would couple modules |
