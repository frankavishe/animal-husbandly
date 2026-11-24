# Data Model — Phase 3 Listings

Existing entities used: `Vendor` (status, species, region/district, slug), `User` (isActive), `Species` enum.

## Enums

| Enum | Values |
|------|--------|
| `ListingType` | `LIVE_ANIMAL`, `MEAT`, `MILK`, `EGGS` (constitution II) |
| `ListingUnit` | `HEAD`, `KG`, `PIECE`, `LITRE`, `TRAY` (tray = 30 eggs) |
| `ListingStatus` | `DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED`, `TAKEN_DOWN` |
| `AnimalSex` | `MALE`, `FEMALE`, `MIXED` |

## Listing (`listings`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | public identifier |
| vendorId | uuid → vendors.id | onDelete Cascade |
| title | text | 3–120 chars |
| description | text | ≤ 2000 chars, default `''` |
| species | `Species` | must be in the shop's species when set/changed (FR-004, service only) |
| listingType | `ListingType` | |
| unit | `ListingUnit` | allowed set per type |
| unitPrice | int | whole TZS, 1–1,000,000,000 |
| stockQuantity | int | 0–1,000,000 (whole kg for KG units) |
| breed | text? | LIVE_ANIMAL only, 2–60 chars |
| sex | `AnimalSex`? | LIVE_ANIMAL only |
| ageMonths | int? | LIVE_ANIMAL only, 0–600 |
| weightKg | decimal(5,1)? | LIVE_ANIMAL only, optional, 0.1–2000 |
| status | `ListingStatus` | default DRAFT |
| publishedAt | timestamptz? | first time ACTIVE |
| archivedAt | timestamptz? | |
| takenDownReason | text? | ≤ 500; cleared on restore |
| takenDownById | uuid? → users.id | onDelete SetNull |
| takenDownAt | timestamptz? | |
| createdAt / updatedAt | timestamptz | |

Indexes: `(status, published_at)`, `(vendor_id, status)`, `(species)`, `(listing_type)`, `(unit_price)`.

### CHECK constraints (migration, raw SQL)

| Name | Rule | FR |
|------|------|----|
| `listings_species_type` | `listing_type IN ('LIVE_ANIMAL','MEAT') OR (listing_type='MILK' AND species='CATTLE') OR (listing_type='EGGS' AND species='CHICKEN')` | FR-003 |
| `listings_unit_type` | LIVE_ANIMAL→HEAD/KG; MEAT→KG/PIECE; MILK→LITRE; EGGS→PIECE/TRAY | FR-005 |
| `listings_animal_fields` | LIVE_ANIMAL ⇒ breed, sex, age_months NOT NULL; otherwise breed, sex, age_months, weight_kg all NULL | FR-007 |
| `listings_ranges` | unit_price 1–1e9; stock_quantity 0–1e6; age_months 0–600; weight_kg 0.1–2000 | FR-006/007 |

## ListingPhoto (`listing_photos`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| listingId | uuid → listings.id | onDelete Cascade |
| key | text | storage key `listings/{listingId}/{uuid}.{ext}` |
| position | int | 0–4 (CHECK `listing_photos_position`); 0 = cover; contiguous after every change |
| createdAt | timestamptz | |

Index: `(listing_id, position)`. Max 5 per listing enforced in a transaction that locks the listing row.

## State transitions

| Action | Actor | From | To | Extra |
|--------|-------|------|----|-------|
| create | vendor (shop APPROVED) | – | DRAFT | |
| publish | vendor (shop APPROVED) | DRAFT | ACTIVE | sets `publishedAt` |
| pause | vendor | ACTIVE | INACTIVE | |
| activate | vendor (shop APPROVED) | INACTIVE | ACTIVE | sets `publishedAt` only if null (restored before ever being published) |
| archive | vendor | DRAFT, ACTIVE, INACTIVE, TAKEN_DOWN | ARCHIVED | sets `archivedAt`; irreversible; photos kept |
| take-down | admin | DRAFT, ACTIVE, INACTIVE | TAKEN_DOWN | reason required; sets by/at |
| restore | admin | TAKEN_DOWN | INACTIVE | clears reason |

Anything else → 409 naming the current status.

## Edit rules

- Editable statuses: DRAFT, ACTIVE, INACTIVE, TAKEN_DOWN (ARCHIVED → 409). Shop must be APPROVED (403).
- `species` / `listingType` changes only in DRAFT (409 otherwise).
- The merged result must pass all rules above (400).

## Visibility

- **Public**: `status = ACTIVE` AND vendor `status = APPROVED` AND owner `isActive = true`.
- **Vendor**: own shop's listings; ARCHIVED excluded unless `status=ARCHIVED` is requested.
- **Admin**: all listings.
