# Research — Phase 3 Listings

No open `NEEDS CLARIFICATION` items remained after `/speckit-clarify`. The decisions below settle the
technical choices the spec leaves to planning.

## R1. Enforcing species/type rules in the database

- **Decision**: CHECK constraint `listings_species_type` on `listings`:
  `listing_type IN ('LIVE_ANIMAL','MEAT') OR (listing_type = 'MILK' AND species = 'CATTLE') OR
  (listing_type = 'EGGS' AND species = 'CHICKEN')`. The service mirrors it in `src/listings/listing-rules.ts`.
- **Rationale**: Principle II accepts "constraint or rule table". The catalogue is fixed and changes only by
  constitution amendment (which would come with a migration anyway), so a CHECK is the smallest correct
  mechanism and cannot be bypassed.
- **Alternatives**: Seeded rule table + composite FK `(species, listing_type)` → adds a table and join, and
  a seed that test databases must not forget; no benefit for a fixed set. Service-only checks → bypassable.

## R2. Other storage-level rules

- **Decision**: Additional CHECKs: unit allowed for type (`listings_unit_type`), live-animal fields
  (`listings_animal_fields`: LIVE_ANIMAL ⇒ breed, sex, age_months NOT NULL; other types ⇒ breed, sex,
  age_months, weight_kg all NULL), ranges (`unit_price 1–1e9`, `stock_quantity 0–1e6`, `age_months 0–600`,
  `weight_kg 0.1–2000`), and `listing_photos.position BETWEEN 0 AND 4`.
- **Rationale**: Same defence-in-depth approach as `payout_method_fields` in Phase 2.
- **Alternatives**: DTO-only validation → bypassable by future code paths (e.g. admin tools, seeds).

## R3. Numeric types

- **Decision**: `unit_price` and `stock_quantity` are `INTEGER`; `weight_kg` is `DECIMAL(5,1)`, serialised
  as a JSON number; DTO uses `@IsNumber({ maxDecimalPlaces: 1 })`.
- **Rationale**: Principle III mandates integer TZS; 1e9 fits int32. Weight is not money but must be exact to
  0.1 kg (clarification), so `Decimal` avoids float drift.
- **Alternatives**: Weight in integer grams → awkward API; `BigInt` price → unnecessary range, JSON friction.

## R4. Status transitions and concurrency

- **Decision**: Each transition is a conditional `updateMany({ where: { id, vendorId, status: { in: allowedFrom } } })`;
  `count === 0` re-reads the listing and returns 409 `Cannot <action> a listing that is <STATUS>` (or 404 if
  not the caller's).
- **Rationale**: Same race-safe pattern as `VendorsService.resubmit`; concurrent changes produce one winner
  and a conflict, never a 500.

## R5. Partial edits and the DRAFT-only species/type lock

- **Decision**: PATCH merges the DTO onto the current row (`null` clears optional live-animal fields), then
  runs `validateListing(merged)`. If `species` or `listingType` differ from the current values and status is
  not DRAFT → 409. If species is set/changed and not in the shop's `species` → 400.
- **Rationale**: Validating the merged result guarantees the stored row always satisfies the rules (and the
  CHECKs), whichever subset of fields was sent.

## R6. Shop gating and ownership

- **Decision**: `ListingsModule` imports `VendorsModule` and uses `VendorsService.findMine(userId)`. Create,
  edit, publish, activate and photo changes require shop status APPROVED (403 `Your shop is not approved` /
  `Your shop is suspended`). Pause and archive are allowed in any shop status. Every vendor query filters by
  the caller's `vendorId`; foreign listings → 404.
- **Rationale**: Principle I (exported service), Principle V (owners only touch their own resources), FR-014.

## R7. Public browsing

- **Decision**: Export `PUBLIC_VENDOR_WHERE` from `vendors.service.ts`; public listing filter is
  `{ status: ACTIVE, vendor: PUBLIC_VENDOR_WHERE }`. Region/district via `vendor.regionId/districtId`, shop via
  `vendor.slug`. Search: case-insensitive `contains` on title OR description. Sort: `publishedAt desc`
  (default), `unitPrice asc|desc`, then `id asc`. `minPrice > maxPrice` → 400.
- **Rationale**: One definition of "visible shop" for both phases. ILIKE over 10k rows with the status index
  stays well under the 1 s target.
- **Alternatives**: `pg_trgm` GIN index / full-text search → deferred until data volume justifies it (YAGNI).

## R8. Photos

- **Decision**: Reuse `detectImageType` and `StorageService`. Generalise the logo interceptor into
  `common/upload/image-upload.interceptor.ts` (`createImageUploadInterceptor(maxBytes, label)`). Add photo:
  fast count check (409 at 5) → upload `listings/{listingId}/{uuid}.{ext}` → interactive transaction that
  locks the listing row (no-op update), re-counts, inserts at `position = count`; on failure the uploaded
  object is deleted. Remove: delete row and compact positions in a transaction, then delete the object
  quietly. Reorder: body `{ photoIds }` must be an exact permutation of current photos (else 400); positions
  rewritten in one transaction. No unique index on `(listing_id, position)`, so reordering needs no
  deferrable constraints. Archiving keeps photos (clarification).
- **Rationale**: FR-023–FR-026; upload-first means a storage failure never leaves a dangling row (FR-025).
- **Alternatives**: Unique `(listing_id, position)` → reorder needs deferred constraints or temporary
  positions; advisory locks → raw SQL for no gain.

## R9. Timestamps and moderation audit

- **Decision**: `publishedAt` set on the first DRAFT → ACTIVE and kept afterwards; `archivedAt` set on
  archive. Take-down sets `takenDownReason`, `takenDownById`, `takenDownAt`; restore → INACTIVE clears only
  the reason, keeping who/when of the last take-down for admins.
- **Rationale**: "Newest" sort reflects when a product first went on sale; admins retain moderation history.
