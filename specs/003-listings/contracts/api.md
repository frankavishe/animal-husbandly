# API Contract — Phase 3 Listings (`/api/v1`)

Auth, error shape and pagination envelope (`{items, page, limit, total, totalPages}`) are as in Phase 1.
The authoritative contract is `/docs` (`/docs-json`).

## Shapes

```
Animal        = { breed, sex: "MALE"|"FEMALE"|"MIXED", ageMonths, weightKg: number|null }
Photo         = { id, url, position }
ShopSummary   = { slug, shopName, region:{id,name}, district:{id,name} }
PublicListing = { id, title, description, species, listingType, unit, unitPrice, stockQuantity, inStock,
                  animal: Animal|null, photos: Photo[] (by position), coverUrl: string|null,
                  publishedAt: string|null, shop: ShopSummary }
OwnerListing  = PublicListing + { status, takenDownReason: string|null, takenDownAt: string|null,
                                  archivedAt: string|null, createdAt, updatedAt }
AdminListing  = OwnerListing + { vendor:{id, slug, shopName, status}, takenDownBy:{id, fullName}|null }
```

`inStock` = `stockQuantity > 0`. Prices are whole TZS integers.

Create body:
```
{ title, description?, species, listingType, unit, unitPrice, stockQuantity,
  breed?, sex?, ageMonths?, weightKg? }   // the last four only (and required except weightKg) for LIVE_ANIMAL
```

## Vendor (`/vendors/me/listings`), role VENDOR

| Method | Path | Body / Query | Success | Errors |
|---|---|---|---|---|
| POST | /vendors/me/listings | create body | 201 OwnerListing (DRAFT) | 400 rule violation / species not in shop, 403 shop not approved, 404 no shop |
| GET | /vendors/me/listings | `page, limit, status?` | 200 Paginated<OwnerListing>, newest created first; ARCHIVED only when `status=ARCHIVED` | 404 no shop |
| GET | /vendors/me/listings/:id | – | 200 OwnerListing | 404 |
| PATCH | /vendors/me/listings/:id | partial create body (`null` clears breed/sex/ageMonths/weightKg) | 200 OwnerListing | 400, 403 shop not approved, 404, 409 ARCHIVED or species/type change outside DRAFT |
| POST | /vendors/me/listings/:id/publish | – | 200 OwnerListing | 403 shop not approved, 409 not DRAFT |
| POST | /vendors/me/listings/:id/pause | – | 200 OwnerListing | 409 not ACTIVE |
| POST | /vendors/me/listings/:id/activate | – | 200 OwnerListing | 403 shop not approved, 409 not INACTIVE |
| POST | /vendors/me/listings/:id/archive | – | 200 OwnerListing | 409 ARCHIVED |
| POST | /vendors/me/listings/:id/photos | multipart `file` | 201 OwnerListing | 400 missing / not JPEG/PNG/WebP, 413 > 5 MB, 409 already 5 photos or ARCHIVED, 403, 404 |
| DELETE | /vendors/me/listings/:id/photos/:photoId | – | 200 OwnerListing | 403, 404, 409 ARCHIVED |
| PUT | /vendors/me/listings/:id/photos/order | `{ photoIds: uuid[] }` | 200 OwnerListing | 400 not an exact permutation, 403, 404, 409 ARCHIVED |

409 message format: `Cannot publish a listing that is ARCHIVED`.

## Public (no auth)

| Method | Path | Query | Success | Errors |
|---|---|---|---|---|
| GET | /listings | `page, limit, species?, listingType?, regionId?, districtId?, shop?` (slug), `minPrice?, maxPrice?, inStock?` (bool), `search?, sort?` (`newest`\|`price_asc`\|`price_desc`, default `newest`) | 200 Paginated<PublicListing> | 400 bad filter / minPrice > maxPrice |
| GET | /listings/:id | – | 200 PublicListing | 404 not visible, 400 bad uuid |

## Admin (`ADMIN` only; others 403)

| Method | Path | Body / Query | Success | Errors |
|---|---|---|---|---|
| GET | /admin/listings | `page, limit, status?, vendorId?, species?, listingType?` | 200 Paginated<AdminListing>, newest created first (all statuses) | |
| GET | /admin/listings/:id | – | 200 AdminListing | 404, 400 bad uuid |
| POST | /admin/listings/:id/take-down | `{ reason }` (1–500) | 200 AdminListing | 400 missing reason, 409 not DRAFT/ACTIVE/INACTIVE |
| POST | /admin/listings/:id/restore | – | 200 AdminListing | 409 not TAKEN_DOWN |
