---
description: "Task list for Phase 2 — Vendors"
---

# Tasks: Vendors

**Input**: Design documents from `/specs/002-vendors/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Required by Constitution VI. Every service gets unit tests, every endpoint group gets e2e tests, and species validation has both passing and failing cases.

Format: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel (different file, no dependency on an incomplete task).

## Phase 1: Setup

- [X] T001 Add dependencies `@aws-sdk/client-s3` and dev `@types/multer` in `package.json` (npm install)
- [X] T002 [P] Add `minio` service (image `minio/minio`, `server /data --console-address :9001`, host ports `9100:9000` and `9101:9001`, root user/password from env defaults `minioadmin`/`minioadmin`, named volume) and a one-shot `minio-init` service (`minio/mc`) that creates bucket `vendor-logos` and runs `mc anonymous set download` on it, in `docker-compose.yml`
- [X] T003 [P] Add `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` and `S3_FORCE_PATH_STYLE` to `.env.example`, `.env` and `.env.test`, using the local MinIO values from `quickstart.md`
- [X] T004 Add Joi rules for the `S3_*` keys (endpoint and public base URL are `uri`, force-path-style is `boolean` default `true`, the rest are required strings) to `AppConfig` in `src/config/env.validation.ts`, and extend `src/config/env.validation.spec.ts` with a "missing S3_BUCKET is rejected" case

## Phase 2: Foundational (blocks all stories)

- [X] T005 Add the following to `prisma/schema.prisma`, using the exact fields, maps, FKs and indexes from `data-model.md`:
  - Enums `VendorStatus`, `Species`, `PayoutMethod` and `MobileMoneyProvider`
  - Model `Vendor` (`vendors`), with `userId` unique and cascade delete, `slug` unique, `species Species[]`, `status` defaulting to PENDING, `reviewedById` on delete SetNull, and `@@index([status])` / `@@index([regionId])`
  - Model `VendorPayoutAccount` (`vendor_payout_accounts`), with `vendorId` unique and cascade delete
  - Relations on `User` (`VendorOwner`, `VendorReviewer`), `Region` and `District`
- [X] T006 Create migration `vendors` with `npx prisma migrate dev --create-only --name vendors`, then append raw SQL:
  - CHECK `vendors_species_not_empty` (`cardinality(species) >= 1`)
  - CHECK `payout_method_fields`, exactly as written in `data-model.md`
  - `CREATE INDEX vendors_species_gin ON vendors USING GIN (species)`
  - Apply it to the dev and test databases.
- [X] T007 [P] Add a `StorageService` abstract class (`put(key, body: Buffer, contentType): Promise<void>`, `delete(key): Promise<void>`, `publicUrl(key): string`) in `src/common/storage/storage.service.ts`
- [X] T008 Add `S3StorageService` in `src/common/storage/s3-storage.service.ts`:
  - Use `S3Client` with endpoint, region, credentials and `forcePathStyle` from `ConfigService`
  - `PutObjectCommand` with `ContentType` and `CacheControl: public, max-age=31536000, immutable`
  - `DeleteObjectCommand`
  - `publicUrl` returns `${S3_PUBLIC_BASE_URL}/${key}`
  - Add a global `StorageModule` in `src/common/storage/storage.module.ts` that provides `{ provide: StorageService, useClass: S3StorageService }`, and export it from `src/common/storage/index.ts`
- [X] T009 [P] Add `detectImageType(buf: Buffer): { mime: 'image/jpeg'|'image/png'|'image/webp'; ext: 'jpg'|'png'|'webp' } | null` using magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF`+4 bytes+`WEBP`) in `src/common/utils/image.ts`. Unit tests go in `src/common/utils/image.spec.ts`, covering each valid type, a text file, a GIF, an empty buffer and a truncated RIFF.
- [X] T010 [P] Add `slugify(name: string): string` in `src/vendors/slug.ts`. It applies NFKD, strips diacritics, removes `'` and `’`, lowercases, turns runs of non-`[a-z0-9]` into `-`, trims dashes and caps at 60 characters without a trailing dash. Unit tests go in `src/vendors/slug.spec.ts` (`"Ng'ombe Bora"`→`ngombe-bora`, accented input, symbols-only→`''`, long name).
- [X] T011 Export `RegionsService` from `src/users/users.module.ts`. Add `assertDistrictInRegion(regionId, districtId)` to `src/users/regions.service.ts` (400 `District does not belong to the selected region`; 400 for an unknown region or district), and refactor `src/users/addresses.service.ts` to use it while keeping existing tests green.
- [X] T012 Add shared DTOs and mappers in `src/vendors/dto/`:
  - `SpeciesEnum`
  - `PublicVendorDto`, `OwnerVendorDto`, `AdminVendorDto` and `PayoutAccountDto` with Swagger `@ApiProperty`, matching the shapes in `contracts/api.md`
  - A `vendorInclude` Prisma include constant (region, district, payoutAccount, owner, reviewedBy)
  - Pure mappers `toPublicVendor`, `toOwnerVendor`, `toAdminVendor` and `toPayoutAccount` (whitelist fields; `logoUrl` via `storage.publicUrl`; `joinedAt = createdAt`) in `src/vendors/vendor.mapper.ts`
- [X] T013 Create `VendorsModule` (imports `UsersModule`; providers and exports filled in by the stories) in `src/vendors/vendors.module.ts`, and register `StorageModule` and `VendorsModule` in `src/app.module.ts`
- [X] T014 E2E harness updates in `test/utils.ts`:
  - An `InMemoryStorage` class extending `StorageService` (a Map of key to {body, contentType}, `publicUrl` = `http://storage.test/${key}`)
  - `createApp` always overrides `StorageService` with it and exposes `ctx.storage`
  - `resetUsers` deletes `vendorPayoutAccount` and `vendor` rows first
  - Helpers `validVendorBody(prisma)` (picks a seeded region and one of its districts; species `['CATTLE']`), `applyVendor(ctx, token, overrides?)` and `approveVendor(ctx, adminToken, vendorId)`

## Phase 3: User Story 1: Apply and manage my shop (P1) MVP

**Goal**: A customer applies for one shop, then views, edits and resubmits it.
**Independent test**: Apply, view as PENDING, edit, second apply returns 409, district mismatch returns 400, and a suspended shop can't be edited.

- [X] T015 [P] [US1] `ApplyVendorDto` in `src/vendors/dto/apply-vendor.dto.ts`:
  - `shopName` "2–80 chars, trimmed"
  - `description?` "≤ 1000 chars"
  - `regionId`/`districtId` positive ints
  - `businessPhone` using the existing TZ phone validator in `src/common/validators/`
  - `species` `@IsArray @ArrayMinSize(1) @ArrayUnique @IsEnum(Species, {each:true})`
  - `UpdateVendorDto = PartialType(ApplyVendorDto)`, rejecting an empty `species` array when present
- [X] T016 [US1] `VendorsService` in `src/vendors/vendors.service.ts`:
  - `apply(user, dto)`:
    - Allowed only for CUSTOMER (403 otherwise), and only if the user has no shop (409 `You already have a shop`)
    - Validate the region/district pair via `RegionsService.assertDistrictInRegion`, and normalise the phone with `normalizeTzPhone`
    - Build the slug from `slugify`; empty → 400 `Shop name must contain letters or digits`
    - Collision handling: find existing `slug`/`slug-N` and use max+1. On P2002 for `slug`, retry once.
    - Create with status PENDING and `submittedAt = now`
  - `getMine(userId)`: 404 `You do not have a shop`
  - `updateMine(userId, dto)`:
    - SUSPENDED → 403 `Your shop is suspended`
    - Re-check region/district (merging the stored values when only one is sent)
    - The slug never changes
  - `resubmit(userId)`: conditional update REJECTED→PENDING, clearing `rejectionReason` and setting `submittedAt = now`; otherwise 409 `Cannot resubmit a shop that is <STATUS>`
  - `assertEditable(vendor)`: a helper reused by the logo and payout code
- [X] T017 [US1] `VendorsController` (`@ApiTags('vendors')`, `@Roles(CUSTOMER, VENDOR)`, `@ApiBearerAuth`) in `src/vendors/vendors.controller.ts`, with `POST /vendors/me` (201), `GET /vendors/me`, `PATCH /vendors/me` and `POST /vendors/me/resubmit` (200), each returning `OwnerVendorDto`. Register the controller and service in `VendorsModule`.
- [X] T018 [P] [US1] Unit tests in `src/vendors/vendors.service.spec.ts` (mocked Prisma, RegionsService, StorageService):
  - Apply success
  - Duplicate → 409; ADMIN → 403
  - Slug collision → `-2`, and P2002 retry
  - Empty slug → 400
  - District mismatch propagates 400
  - Valid species passes; an empty or unknown species fails at the DTO (class-validator `validate`)
  - Update on SUSPENDED → 403; update keeps the slug
  - Resubmit REJECTED → PENDING; resubmit PENDING → 409
- [X] T019 [US1] E2E in `test/vendors.e2e-spec.ts` (describe "owner"):
  - Apply → 201 PENDING with slug
  - Second apply → 409
  - Same name by another user → `-2` slug
  - District not in region → 400
  - Species `['MILK']` or `[]` → 400
  - Unknown field → 400
  - `GET /vendors/me` without a shop → 404
  - PATCH updates the description and keeps the slug
  - Resubmit on PENDING → 409
  - Unauthenticated → 401

## Phase 4: User Story 2: Admin review and moderation (P1)

**Goal**: An admin lists and inspects shops and runs approve, reject, suspend and reactivate. Approval makes the owner a VENDOR.
**Independent test**: Reject with a reason, resubmit and approve; the owner's next `/auth/me` shows VENDOR. Suspend and reactivate; invalid transitions return 409.

- [X] T020 [P] [US2] Admin DTOs in `src/vendors/dto/admin-vendor.dto.ts`: `AdminListVendorsQueryDto` (extends the pagination DTO from `src/common/dto/pagination.dto.ts`; `status?` IsEnum(VendorStatus); `search?` ≤ 100) and `RejectVendorDto` (`reason` "1–500 chars", trimmed, required)
- [X] T021 [US2] `VendorsAdminService` in `src/vendors/vendors-admin.service.ts`:
  - `list(q)`: filter on status and a case-insensitive `shopName contains`, ordered by `submittedAt desc`, using `paginate`/`toSkipTake`
  - `get(id)`: 404 `Shop not found`
  - A private `transition(adminId, id, action, from, to, extra)` that runs `updateMany({where:{id,status:from}})` inside `$transaction`. If the count is 0, load the shop and return 404 if it is missing, otherwise 409 `Cannot <action> a shop that is <STATUS>`. It also sets `reviewedById` and `reviewedAt`.
  - `approve`: in the same transaction, refuse (409 `Owner account is deactivated`) if the owner is inactive, and set `user.role = VENDOR`
  - `reject(reason)` sets `rejectionReason`
  - `suspend` and `reactivate`
  - Export it from `VendorsModule`.
- [X] T022 [US2] `AdminVendorsController` (`@Roles(ADMIN)`, `@ApiTags('admin')`) in `src/admin/admin-vendors.controller.ts`:
  - `GET /admin/vendors` and `GET /admin/vendors/:id` (ParseUUIDPipe)
  - `POST /admin/vendors/:id/approve|reject|suspend|reactivate` (HttpCode 200), each returning `AdminVendorDto`
  - Import `VendorsModule` in `src/admin/admin.module.ts`
- [X] T023 [P] [US2] Unit tests in `src/vendors/vendors-admin.service.spec.ts`:
  - Every valid transition
  - Every invalid (action, status) pair → 409 with the status in the message
  - Unknown id → 404
  - Approve sets role VENDOR inside the transaction
  - Approve with an inactive owner → 409
  - Reject stores the reason
  - Reviewer fields are set
  - List builds the status and search filter
- [X] T024 [US2] E2E in `test/admin-vendors.e2e-spec.ts`:
  - A customer calling `/admin/vendors` → 403
  - List filtered by PENDING returns only pending shops, paginated
  - Reject without a reason → 400
  - Reject → owner `GET /vendors/me` shows the reason
  - Owner resubmits → PENDING
  - Approve → owner `GET /auth/me` role VENDOR on the next request with the same token
  - Approve again → 409 `Cannot approve a shop that is APPROVED`
  - Suspend → owner PATCH → 403
  - Reactivate → APPROVED
  - Suspend a PENDING shop → 409
  - Approve when the owner is deactivated (via `PATCH /admin/users/:id/status`) → 409
  - Detail includes `owner` and `reviewedBy`

## Phase 5: User Story 3: Public shop browsing (P2)

**Goal**: Anonymous users list and view approved shops of active owners only, without private fields.
**Independent test**: With shops in every status plus a deactivated owner, only approved shops of active owners appear, filters work, and no private keys are present.

- [X] T025 [P] [US3] `PublicListVendorsQueryDto` (pagination plus `regionId?`, `districtId?` positive ints, `species?` IsEnum(Species), `search?` ≤ 100) in `src/vendors/dto/public-list-vendors.dto.ts`
- [X] T026 [US3] Add to `src/vendors/vendors.service.ts`:
  - `listPublic(q)`: `where {status: APPROVED, user: {isActive: true}}` plus region, district, `species: { has }` and a case-insensitive `shopName contains`; order by `createdAt desc`; mapped with `toPublicVendor`
  - `getPublicBySlug(slug)`: same visibility, 404 `Shop not found`
- [X] T027 [US3] `PublicVendorsController` in `src/vendors/public-vendors.controller.ts`: `@Public()`, `GET /vendors` and `GET /vendors/:slug`, returning `PublicVendorDto`. Register it in `VendorsModule` and make sure the `/vendors/me` routes are declared first or otherwise take precedence over `/vendors/:slug`.
- [X] T028 [P] [US3] Add unit tests to `src/vendors/vendors.service.spec.ts` for the public where-clause composition and the 404 on a hidden slug, and add `src/vendors/vendor.mapper.spec.ts` asserting that `toPublicVendor` output keys are exactly those in FR-019
- [X] T029 [US3] E2E in `test/vendors.e2e-spec.ts` (describe "public"):
  - Seed PENDING, REJECTED, SUSPENDED, APPROVED and APPROVED-with-deactivated-owner shops
  - Anonymous list returns only the active approved one
  - The region, district, species and search filters work
  - `GET /vendors/:slug` returns no `payoutAccount`, `rejectionReason`, `reviewedBy`, `owner` or `status` keys
  - A hidden slug → 404
  - `limit=101` → 400

## Phase 6: User Story 4: Shop logo and payout account (P2)

**Goal**: Owners manage a verified logo in object storage and one payout account that is visible only to the owner and admins.
**Independent test**: Upload a PNG and see `logoUrl`, replacing it deletes the old object, a fake PNG returns 400, a file over 2 MB returns 413; payout works for MOBILE_MONEY and switching to BANK; mixed fields return 400; an admin sees the payout and the public view doesn't.

- [X] T030 [US4] Logo methods in `src/vendors/vendors.service.ts`:
  - `setLogo(userId, file)`:
    - Missing file → 400 `A logo file is required`
    - Call `assertEditable`
    - `detectImageType` null → 400 `Logo must be a JPEG, PNG or WebP image`
    - Store under key `vendors/<vendorId>/logo-<uuid>.<ext>` with `storage.put`, then update `logoKey`
    - Then best-effort `storage.delete(oldKey)`, logging a warning on failure
  - `removeLogo(userId)`: clear `logoKey`, then best-effort delete
- [X] T031 [US4] Add to `src/vendors/vendors.controller.ts`:
  - `PUT /vendors/me/logo` with `FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } })`, `@ApiConsumes('multipart/form-data')` and an `@ApiBody` schema with binary `file`
  - Map multer `PayloadTooLargeException`/`LIMIT_FILE_SIZE` to 413 `Logo must be at most 2 MB`; check that `AllExceptionsFilter` in `src/common/filters/all-exceptions.filter.ts` preserves 413
  - `DELETE /vendors/me/logo` (200 `OwnerVendorDto`)
- [X] T032 [P] [US4] `UpsertPayoutAccountDto` in `src/vendors/dto/payout-account.dto.ts`:
  - `method` IsEnum(PayoutMethod)
  - `accountName` "2–100 chars"
  - `@ValidateIf(o => o.method==='MOBILE_MONEY')` for `provider` IsEnum(MobileMoneyProvider) and `mobileNumber` (TZ phone)
  - `@ValidateIf(o => o.method==='BANK')` for `bankName` "2–100 chars" and `accountNumber` `^\d{6,30}$`
- [X] T033 [US4] `PayoutAccountsService` in `src/vendors/payout-accounts.service.ts`:
  - `getMine(userId)`: 404 `You do not have a shop` or `No payout account set`
  - `upsertMine(userId, dto)`:
    - Call `assertEditable`
    - Reject fields from the other method with 400 `<field> is not allowed for <METHOD> payouts`
    - Normalise `mobileNumber`
    - Upsert by `vendorId`, explicitly nulling the other method's columns
  - Register it in `VendorsModule`. Add `GET` and `PUT /vendors/me/payout-account` to `src/vendors/vendors.controller.ts`.
- [X] T034 [P] [US4] Unit tests:
  - `src/vendors/payout-accounts.service.spec.ts`: mobile success with phone normalisation, bank success, switching method nulls the other columns, foreign fields → 400, suspended → 403, no shop → 404, and DTO validation of the missing provider and accountNumber cases
  - Logo cases in `src/vendors/vendors.service.spec.ts`: a non-image → 400 with no `put`, success replaces the key and deletes the old one, a `put` failure leaves `logoKey` unchanged, and a delete failure is swallowed
- [X] T035 [US4] E2E in `test/vendors.e2e-spec.ts` (describe "logo & payout"):
  - PNG upload → `logoUrl` starts with `http://storage.test/vendors/` and the object exists in `ctx.storage`
  - A second upload deletes the first object
  - A text file named `.png` → 400
  - A 2 MB + 1 byte buffer → 413
  - DELETE clears `logoUrl`
  - No shop → 404
  - Payout MOBILE_MONEY `0754123456` → `+255754123456`; switch to BANK; BANK with `provider` → 400; MOBILE_MONEY without a provider → 400
  - The admin `GET /admin/vendors/:id` includes `payoutAccount`, and public `GET /vendors/:slug` doesn't
  - A direct Prisma insert violating `payout_method_fields` throws (DB CHECK)

## Phase 7: Polish

- [X] T036 [P] Add a Vendors section to `README.md` (MinIO setup, ports 9100/9101, S3 env keys, the vendor lifecycle)
- [X] T037 [P] E2E in `test/foundation.e2e-spec.ts`: `/docs-json` contains every new path from `contracts/api.md` (SC-007)
- [X] T038 Manually run the `quickstart.md` scenarios 1–6 against MinIO (`docker compose up -d minio minio-init`)
- [X] T039 Quality gate: `npm run lint`, `npm run build`, `npm test` and `npm run test:e2e` all green

## Dependencies

- Setup (T001–T004) → Foundational (T005–T014) → US1 (T015–T019) → US2 (T020–T024) → US3 and US4, which are independent of each other after US2 (US3 needs approved shops; US4 e2e checks the admin detail).
- T005 → T006. T007 → T008. T011, T012 and T013 block T016. T014 blocks all e2e tasks.
- Within each story: DTOs → service → controller → unit tests → e2e.

## Parallel examples

- Foundational: T007, T009 and T010 together; then T008, T011 and T012.
- US1: T015 alongside T018 test scaffolding.
- US2: T020 and T023.
- US3 and US4 can proceed in parallel: T025/T026 versus T030/T032/T033 (they touch different methods of `vendors.service.ts`, so merge carefully).
- Polish: T036 and T037.

## Implementation strategy

1. MVP = Setup + Foundational + US1 + US2. A customer can apply and an admin can approve them into a VENDOR, which is the minimum the listings phase needs.
2. Add US3 (discovery), then US4 (logo and payout).
3. Commit after each phase, and run the full quality gate (T039) before owner sign-off.
