---
description: "Task list for Phase 3 — Listings"
---

# Tasks: Listings

**Input**: Design documents from `/specs/003-listings/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Required by Constitution VI. Every service gets unit tests, every endpoint group gets e2e tests, and the Principle II species/type rules have passing and failing cases at both the service and the database level.

Format: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel (different file, no dependency on an incomplete task).

## Phase 1: Setup

No new dependencies or env keys.

- [X] T001 Generalise the logo upload interceptor into `src/common/upload/image-upload.interceptor.ts`:
  - Export `createImageUploadInterceptor(maxBytes: number, label: string)` returning an injectable interceptor class that wraps `FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxBytes, files: 1 } })` and maps `PayloadTooLargeException` to 413 `<label> must be at most <N> MB`
  - Switch `src/vendors/vendors.controller.ts` to `createImageUploadInterceptor(2 * 1024 * 1024, 'Logo')`, keep `MAX_LOGO_BYTES` exported from the new location if referenced, and delete `src/vendors/logo-upload.interceptor.ts`
  - `test/vendors.e2e-spec.ts` must still pass unchanged (413 message `Logo must be at most 2 MB`)
- [X] T002 [P] In `src/vendors/vendors.service.ts`, rename the private `PUBLIC_WHERE` to an exported `PUBLIC_VENDOR_WHERE: Prisma.VendorWhereInput = { status: APPROVED, user: { isActive: true } }` and use it in `publicWhere` and `getPublicBySlug` (no behaviour change)

## Phase 2: Foundational (blocks all stories)

- [X] T003 Add the following to `prisma/schema.prisma`, using the exact fields, maps, FKs and indexes from `data-model.md`:
  - Enums `ListingType { LIVE_ANIMAL MEAT MILK EGGS }`, `ListingUnit { HEAD KG PIECE LITRE TRAY }`, `ListingStatus { DRAFT ACTIVE INACTIVE ARCHIVED TAKEN_DOWN }`, `AnimalSex { MALE FEMALE MIXED }`
  - Model `Listing` (`listings`): `vendorId` → vendors onDelete Cascade; `title`; `description` default `""`; `species Species`; `listingType`; `unit`; `unitPrice Int`; `stockQuantity Int`; `breed String?`; `sex AnimalSex?`; `ageMonths Int?`; `weightKg Decimal? @db.Decimal(5, 1)`; `status` default DRAFT; `publishedAt`, `archivedAt`, `takenDownAt` `DateTime? @db.Timestamptz(3)`; `takenDownReason String?`; `takenDownById` → users onDelete SetNull (relation `ListingTakenDownBy`); `createdAt`/`updatedAt`; `@@index([status, publishedAt])`, `@@index([vendorId, status])`, `@@index([species])`, `@@index([listingType])`, `@@index([unitPrice])`
  - Model `ListingPhoto` (`listing_photos`): `listingId` → listings onDelete Cascade; `key`; `position Int`; `createdAt`; `@@index([listingId, position])`
  - Relations `Vendor.listings Listing[]` and `User.takenDownListings Listing[] @relation("ListingTakenDownBy")`
- [X] T004 Create migration `listings` with `npx prisma migrate dev --create-only --name listings`, then append raw SQL exactly as in `data-model.md`, and apply it to the dev and test databases:
  - CHECK `listings_species_type`: `listing_type IN ('LIVE_ANIMAL','MEAT') OR (listing_type='MILK' AND species='CATTLE') OR (listing_type='EGGS' AND species='CHICKEN')`
  - CHECK `listings_unit_type`: LIVE_ANIMAL→HEAD/KG; MEAT→KG/PIECE; MILK→LITRE; EGGS→PIECE/TRAY
  - CHECK `listings_animal_fields`: LIVE_ANIMAL ⇒ breed, sex, age_months NOT NULL; otherwise breed, sex, age_months, weight_kg all NULL
  - CHECK `listings_ranges`: unit_price 1–1000000000; stock_quantity 0–1000000; age_months NULL or 0–600; weight_kg NULL or 0.1–2000
  - CHECK `listing_photos_position`: `position BETWEEN 0 AND 4`
- [X] T005 [P] Add the pure rules module `src/listings/listing-rules.ts`:
  - `ALLOWED_UNITS: Record<ListingType, ListingUnit[]>` = LIVE_ANIMAL [HEAD, KG], MEAT [KG, PIECE], MILK [LITRE], EGGS [PIECE, TRAY]
  - `isAllowedCombination(species, type)`: LIVE_ANIMAL/MEAT any species; MILK only CATTLE; EGGS only CHICKEN
  - `validateListing(l: { species, listingType, unit, breed?, sex?, ageMonths?, weightKg? })` throws `BadRequestException` with messages `MILK listings are only allowed for CATTLE`, `EGGS listings are only allowed for CHICKEN`, `Unit <UNIT> is not allowed for <TYPE> listings`, `LIVE_ANIMAL listings require breed, sex and ageMonths`, `<field> is only allowed for LIVE_ANIMAL listings`
  - Unit tests in `src/listings/listing-rules.spec.ts`: all 24 species × type combinations (the 10 invalid pairs — MILK for GOAT, SHEEP, PIG, CHICKEN, FISH and EGGS for CATTLE, GOAT, SHEEP, PIG, FISH — fail; the other 14 pass), every allowed/disallowed unit per type, LIVE_ANIMAL missing each required field, each animal field on MEAT/MILK/EGGS
- [X] T006 Response DTOs and mapper:
  - In `src/listings/dto/listing-response.dto.ts`: `AnimalDto { breed, sex, ageMonths, weightKg: number|null }`, `PhotoDto { id, url, position }`, `ShopSummaryDto { slug, shopName, region:{id,name}, district:{id,name} }`, `PublicListingDto`, `OwnerListingDto` (adds `status, takenDownReason, takenDownAt, archivedAt, createdAt, updatedAt`), `AdminListingDto` (adds `vendor:{id,slug,shopName,status}`, `takenDownBy:{id,fullName}|null`), and paginated wrappers, all with `@ApiProperty`, matching `contracts/api.md`
  - In `src/listings/listing.mapper.ts`: `listingInclude` (photos ordered by position, vendor with region/district, takenDownBy) and pure `toPublicListing(l, storage)`, `toOwnerListing`, `toAdminListing` that whitelist fields; `weightKg` via `Number(decimal)` or null; `inStock = stockQuantity > 0`; `animal` null unless LIVE_ANIMAL; `coverUrl` = first photo url or null
  - `src/listings/dto/index.ts` barrel
- [X] T007 Create `ListingsModule` (imports `VendorsModule`; providers/controllers filled in by the stories) in `src/listings/listings.module.ts`, and register it in `src/app.module.ts`
- [X] T008 E2E harness updates in `test/utils.ts`:
  - `resetUsers` deletes `listingPhoto` and `listing` rows before vendors
  - Move the `PNG` buffer from `test/vendors.e2e-spec.ts` into exported `PNG` / `JPEG` (`FF D8 FF` + padding) constants and import them back in the vendor spec
  - Helpers `validListingBody(overrides?)` (CATTLE, LIVE_ANIMAL, HEAD, unitPrice 1200000, stockQuantity 3, breed `Boran`, sex FEMALE, ageMonths 30), `createListing(ctx, token, overrides?)` (asserts 201, returns body) and `publishListing(ctx, token, id)` (asserts 200)

**Checkpoint**: schema, rules and harness ready.

## Phase 3: User Story 1: Create and manage my listings (P1) MVP

**Goal**: An approved vendor creates, lists, views and edits their own listings; invalid products are impossible.
**Independent test**: Create cattle LIVE_ANIMAL and chicken EGGS listings, goat MILK and cattle EGGS return 400, list mine, edit a price, another vendor gets 404.

- [X] T009 [P] [US1] Request DTOs in `src/listings/dto/create-listing.dto.ts`:
  - `CreateListingDto`: `title` "3–120 chars", trimmed; `description?` "≤ 2000 chars"; `species` IsEnum(Species); `listingType` IsEnum(ListingType); `unit` IsEnum(ListingUnit); `unitPrice` IsInt 1–1,000,000,000; `stockQuantity` IsInt 0–1,000,000; `breed?` "2–60 chars", trimmed; `sex?` IsEnum(AnimalSex); `ageMonths?` IsInt 0–600; `weightKg?` `IsNumber({ maxDecimalPlaces: 1 })` 0.1–2000
  - `UpdateListingDto = PartialType(CreateListingDto)`, where `breed`, `sex`, `ageMonths`, `weightKg` accept `null` (`@ValidateIf((_, v) => v !== null)`) meaning "clear"
  - `VendorListListingsQueryDto` extends `PaginationQueryDto` with `status?` IsEnum(ListingStatus)
- [X] T010 [US1] `ListingsService` (vendor part) in `src/listings/listings.service.ts`, using `VendorsService.findMine(userId)`:
  - `assertShopApproved(vendor)`: SUSPENDED → 403 `Your shop is suspended`; PENDING/REJECTED → 403 `Your shop is not approved`
  - `create(userId, dto)`: shop gate; `dto.species` not in `vendor.species` → 400 `Your shop does not deal in <SPECIES>`; `validateListing(dto)`; create with status DRAFT; return `toOwnerListing`
  - `listMine(userId, q)`: `where { vendorId, status: q.status ?? { not: ARCHIVED } }`, order `createdAt desc, id asc`, paginated
  - `getMine(userId, id)`: `findFirst({ id, vendorId })` else 404 `Listing not found`
  - `updateMine(userId, id, dto)`: load own listing; ARCHIVED → 409 `Cannot edit a listing that is ARCHIVED`; shop gate; `species` or `listingType` differing from current while status ≠ DRAFT → 409 `Species and listing type can only be changed while the listing is DRAFT (current: <STATUS>)`; species changed and not in shop → 400; merge (`undefined` keeps, `null` clears) then `validateListing(merged)`; update and return owner shape
- [X] T011 [US1] `VendorListingsController` (`@ApiTags('listings')`, `@ApiBearerAuth`, `@Roles(Role.VENDOR)`, `@Controller('vendors/me/listings')`) in `src/listings/vendor-listings.controller.ts`: `POST` (201), `GET`, `GET :id` (ParseUUIDPipe), `PATCH :id`, returning `OwnerListingDto` / paginated; register controller and service in `ListingsModule`
- [X] T012 [P] [US1] Unit tests in `src/listings/listings.service.spec.ts` (mocked Prisma, VendorsService, StorageService): create success as DRAFT; PENDING/SUSPENDED shop → 403; species not in shop → 400; GOAT+MILK → 400 with the rule message; foreign id → 404; species change on ACTIVE → 409; species change on DRAFT re-validated; `null` clears animal fields when switching DRAFT to MEAT; ARCHIVED edit → 409
- [X] T013 [US1] E2E in `test/listings.e2e-spec.ts` (describe "vendor"):
  - Spec US1 scenarios 1–11 (including CHICKEN EGGS TRAY 201, MILK by KG 400, MEAT with `breed` 400, price 0 / 1.5 → 400, stock -1 → 400, weight 350.55 → 400 and 350.5 → 201, group GOAT MIXED stock 10 → 201)
  - CUSTOMER (no shop) → 403; PENDING shop vendor → 403; unknown field → 400; unauthenticated → 401
  - DB level (SC-002): `prisma.$executeRaw` inserting a GOAT/MILK row for an approved vendor rejects with a `listings_species_type` violation

**Checkpoint**: US1 works on its own (listings exist as drafts).

## Phase 4: User Story 2: Publish, pause and archive (P1)

**Goal**: Vendors control what buyers see through the DRAFT/ACTIVE/INACTIVE/ARCHIVED lifecycle.
**Independent test**: Publish, pause, activate, archive; each invalid step returns 409 naming the current status.

- [X] T014 [US2] Add to `src/listings/listings.service.ts` a private `transition(userId, id, action, from: ListingStatus[], to, data, opts: { requireApproved: boolean })` that resolves the shop, applies the shop gate when required, runs `updateMany({ where: { id, vendorId, status: { in: from } }, data })`, and on `count === 0` loads the listing → 404 `Listing not found` or 409 `Cannot <action> a listing that is <STATUS>`. Public methods:
  - `publish`: DRAFT → ACTIVE, sets `publishedAt = now`, requires approved shop
  - `pause`: ACTIVE → INACTIVE (no shop gate)
  - `activate`: INACTIVE → ACTIVE, keeps `publishedAt`, requires approved shop
  - `archive`: DRAFT/ACTIVE/INACTIVE/TAKEN_DOWN → ARCHIVED, sets `archivedAt = now` (no shop gate)
- [X] T015 [US2] Add `POST :id/publish|pause|activate|archive` (HttpCode 200, `@ApiConflictResponse`) to `src/listings/vendor-listings.controller.ts`
- [X] T016 [P] [US2] Unit tests in `src/listings/listings.service.spec.ts`: each valid transition; each invalid (action, status) pair → 409 containing the status; publish on SUSPENDED shop → 403 while pause and archive succeed; `publishedAt` not overwritten by activate; TAKEN_DOWN publish/activate → 409
- [X] T017 [US2] E2E in `test/listings.e2e-spec.ts` (describe "lifecycle"): spec US2 scenarios 1–6, including stock 0 publishable, archived listing hidden from `GET /vendors/me/listings` but returned with `status=ARCHIVED`, edit after archive → 409, and after admin suspends the shop `PATCH` → 403 while `pause` → 200

**Checkpoint**: MVP complete (US1 + US2).

## Phase 5: User Story 3: Browse listings publicly (P2)

**Goal**: Anyone finds ACTIVE listings of visible shops with filters, search and sorting, without private data.
**Independent test**: With listings in every status across shops in every status, only visible ones appear; filters and sorts work; no private keys.

- [X] T018 [P] [US3] `PublicListListingsQueryDto` in `src/listings/dto/public-list-listings.dto.ts`: extends `PaginationQueryDto`; `species?`, `listingType?` enums; `regionId?`, `districtId?` positive ints; `shop?` "≤ 100 chars"; `minPrice?`, `maxPrice?` ints 0–1,000,000,000; `inStock?` boolean (`@Transform` `'true'`/`'false'` → boolean, else invalid); `search?` "≤ 100 chars"; `sort?` IsIn(`newest`, `price_asc`, `price_desc`) default `newest`
- [X] T019 [US3] Add to `src/listings/listings.service.ts`:
  - `static publicWhere(q)`: `{ status: ACTIVE, vendor: { ...PUBLIC_VENDOR_WHERE, regionId?, districtId?, slug? } }` plus `species`, `listingType`, `unitPrice: { gte, lte }`, `stockQuantity: { gt: 0 }` when `inStock`, and `OR [title contains, description contains]` (mode insensitive) for `search`
  - `listPublic(q)`: `minPrice > maxPrice` → 400 `minPrice must not exceed maxPrice`; orderBy `newest` → `[publishedAt desc, id asc]`, `price_asc` → `[unitPrice asc, id asc]`, `price_desc` → `[unitPrice desc, id asc]`; paginated `toPublicListing`
  - `getPublic(id)`: same visibility, else 404 `Listing not found`
- [X] T020 [US3] `PublicListingsController` (`@Public()`, `@ApiTags('listings')`, `@Controller('listings')`) in `src/listings/public-listings.controller.ts`: `GET /listings`, `GET /listings/:id` (ParseUUIDPipe); register in `ListingsModule`
- [X] T021 [P] [US3] Unit tests: `publicWhere`/orderBy composition and min>max 400 in `src/listings/listings.service.spec.ts`; `src/listings/listing.mapper.spec.ts` asserting `toPublicListing` keys are exactly those in FR-019, `animal` null for MEAT, `weightKg` numeric, `coverUrl` = position 0
- [X] T022 [US3] E2E in `test/listings.e2e-spec.ts` (describe "public"): seed listings in DRAFT/ACTIVE/INACTIVE/ARCHIVED/TAKEN_DOWN (set TAKEN_DOWN via Prisma), an ACTIVE listing of a suspended shop and of a deactivated owner; anonymous list returns only visible ones; filters species, listingType, regionId, districtId, shop, minPrice/maxPrice, inStock, search `boran` (case-insensitive) each narrow results; sorts `price_asc`/`price_desc` order correctly; detail has `shop` summary and none of `status`, `takenDownReason`, `vendor`, `payoutAccount`; hidden id → 404; `minPrice=5&maxPrice=1` → 400; `limit=101` → 400

## Phase 6: User Story 4: Listing photos (P2)

**Goal**: Vendors manage up to 5 verified photos per listing, ordered, first is cover.
**Independent test**: Upload 3, reorder, remove one, sixth and disguised files refused, public view shows order.

- [X] T023 [US4] `ListingPhotosService` in `src/listings/listing-photos.service.ts` (uses `VendorsService`, `PrismaService`, `StorageService`, `detectImageType`):
  - `add(userId, listingId, file)`: missing file → 400 `A photo file is required`; own listing else 404; shop gate; ARCHIVED → 409 `Cannot change photos of a listing that is ARCHIVED`; current count ≥ 5 → 409 `A listing can have at most 5 photos`; `detectImageType` null → 400 `Photo must be a JPEG, PNG or WebP image`; `storage.put('listings/<listingId>/<uuid>.<ext>')`; then interactive `$transaction`: lock with `listing.update({ where: { id }, data: { updatedAt: new Date() } })`, re-count (≥ 5 → 409), create at `position = count`; if the transaction throws, best-effort `storage.delete(key)` and rethrow; return `toOwnerListing`
  - `remove(userId, listingId, photoId)`: gates as above; photo not on this listing → 404 `Photo not found`; transaction deletes it and decrements `position` of later photos; afterwards best-effort delete of the object (warn on failure)
  - `reorder(userId, listingId, photoIds)`: gates; `photoIds` must be exactly the set of current photo ids (no missing, extra or duplicate) else 400 `photoIds must list every photo of the listing exactly once`; transaction sets `position = index`
- [X] T024 [US4] Routes in `src/listings/vendor-listings.controller.ts`: `POST :id/photos` with `@UseInterceptors(createImageUploadInterceptor(5 * 1024 * 1024, 'Photo'))`, `@ApiConsumes('multipart/form-data')`, `@ApiBody` binary `file`, HttpCode 201; `DELETE :id/photos/:photoId`; `PUT :id/photos/order` with `ReorderPhotosDto` (`photoIds` `@IsArray @ArrayMinSize(1) @ArrayMaxSize(5) @ArrayUnique @IsUUID('4', { each: true })`) in `src/listings/dto/reorder-photos.dto.ts`; register `ListingPhotosService` in `ListingsModule`
- [ ] T025 [P] [US4] Unit tests in `src/listings/listing-photos.service.spec.ts`: non-image → 400 and `put` not called; 5 existing → 409 before upload; transaction failure deletes the uploaded key; remove compacts positions and deletes the object; storage delete failure swallowed; reorder with missing / duplicate / foreign id → 400; suspended shop → 403
- [ ] T026 [US4] E2E in `test/listing-photos.e2e-spec.ts`: upload PNG, JPEG, PNG → positions 0–2, keys under `listings/<id>/`, objects present in `ctx.storage`, `coverUrl` = first; reorder reversed → cover changes and public `GET /listings/:id` shows the new order; text file named `.jpg` → 400; `5 * 1024 * 1024 + 1` bytes → 413 `Photo must be at most 5 MB`; sixth upload → 409; remove middle photo → positions compact to 0–1 and object deleted; another vendor → 404; archive → photos still in `ctx.storage`, further photo ops → 409

## Phase 7: User Story 5: Admin moderates listings (P3)

**Goal**: Admins list and inspect all listings, take one down with a reason, and restore it.
**Independent test**: Take down an ACTIVE listing, it disappears publicly, vendor sees the reason and cannot publish; restore → INACTIVE → vendor activates.

- [ ] T027 [P] [US5] Admin DTOs in `src/listings/dto/admin-listing.dto.ts`: `AdminListListingsQueryDto` (pagination; `status?` IsEnum(ListingStatus); `vendorId?` IsUUID; `species?`; `listingType?`) and `TakeDownListingDto` (`reason` "1–500 chars", trimmed, required)
- [ ] T028 [US5] `ListingsAdminService` in `src/listings/listings-admin.service.ts`: `list(q)` all statuses, order `createdAt desc, id asc`, paginated `toAdminListing`; `get(id)` 404 `Listing not found`; private `transition` (conditional `updateMany`, 404/409 `Cannot <action> a listing that is <STATUS>`); `takeDown(adminId, id, reason)` DRAFT/ACTIVE/INACTIVE → TAKEN_DOWN setting `takenDownReason`, `takenDownById`, `takenDownAt`; `restore(adminId, id)` TAKEN_DOWN → INACTIVE clearing `takenDownReason` only; export it from `ListingsModule`
- [ ] T029 [US5] `AdminListingsController` (`@Roles(Role.ADMIN)`, `@ApiTags('admin')`, `@ApiBearerAuth`) in `src/admin/admin-listings.controller.ts`: `GET /admin/listings`, `GET /admin/listings/:id`, `POST /admin/listings/:id/take-down`, `POST /admin/listings/:id/restore` (HttpCode 200, `AdminListingDto`); import `ListingsModule` in `src/admin/admin.module.ts`
- [ ] T030 [P] [US5] Unit tests in `src/listings/listings-admin.service.spec.ts`: take-down from each allowed status records reason/by/at; take-down of ARCHIVED/TAKEN_DOWN → 409; restore → INACTIVE clears reason and keeps by/at; restore of ACTIVE → 409; unknown id → 404; list filter composition
- [ ] T031 [US5] E2E in `test/admin-listings.e2e-spec.ts`: spec US5 scenarios 1–6 (customer and vendor → 403; filters status/vendorId/species/listingType include ARCHIVED; take-down without reason → 400; public `GET /listings/:id` → 404 after take-down; vendor `GET` shows `takenDownReason`; vendor publish/activate → 409; vendor can still edit and archive; restore → vendor `activate` → ACTIVE)

## Phase 8: Polish

- [ ] T032 [P] Add a Listings section to `README.md` (lifecycle diagram in text, species/type/unit rules, photo limits, endpoint groups)
- [ ] T033 [P] Extend the `/docs-json` check in `test/foundation.e2e-spec.ts` with every new path from `contracts/api.md` (SC-007)
- [ ] T034 Manually run `quickstart.md` scenarios 1–8 against MinIO (`docker compose up -d db minio minio-init`, `npm run start:dev`)
- [ ] T035 Quality gate: `npm run lint`, `npm run build`, `npm test` and `npm run test:e2e` all green

## Dependencies

- Setup (T001–T002) → Foundational (T003–T008) → US1 (T009–T013) → US2 (T014–T017) → US3, US4 and US5, which are independent of each other after US2 (US3 e2e needs published listings; US5 needs the lifecycle states).
- T003 → T004. T005 and T006 block T010. T007 blocks every controller task. T008 blocks all e2e tasks. T001 blocks T024.
- Within each story: DTOs → service → controller → unit tests → e2e.

## Parallel examples

- Setup: T001 and T002.
- Foundational: T005 alongside T003/T004; then T006 and T008.
- US1: T009 alongside T012 test scaffolding.
- US2: T016 alongside T015.
- After US2: US3 (T018–T022), US4 (T023–T026) and US5 (T027–T031) in parallel; they touch different files except `listings.service.ts` (US3) vs `vendor-listings.controller.ts` (US4), and `listings.module.ts` registration (merge carefully).
- Polish: T032 and T033.

## Implementation strategy

1. MVP = Setup + Foundational + US1 + US2: approved vendors can create, validate and publish listings with every domain rule enforced at service and DB level.
2. Add US3 (public discovery), then US4 (photos), then US5 (moderation).
3. Commit after each phase, and run the full quality gate (T035) before owner sign-off.
