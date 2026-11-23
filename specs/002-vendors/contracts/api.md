# API Contract — Phase 2 Vendors (`/api/v1`)

Auth, error shape and pagination envelope (`{items, page, limit, total, totalPages}`) are as in Phase 1.
The authoritative contract is `/docs` (`/docs-json`).

## Shapes

```
PublicVendor = { slug, shopName, description, region:{id,name}, district:{id,name},
                 businessPhone, species: Species[], logoUrl: string|null, joinedAt }
OwnerVendor  = PublicVendor + { id, status, rejectionReason: string|null, submittedAt, reviewedAt: string|null,
                                payoutAccount: PayoutAccount|null }
AdminVendor  = OwnerVendor + { owner:{id, fullName, phone, email, isActive}, reviewedBy:{id, fullName}|null, createdAt }
PayoutAccount = { method:"MOBILE_MONEY", provider, mobileNumber, accountName, updatedAt }
              | { method:"BANK", bankName, accountNumber, accountName, updatedAt }
```
`joinedAt` = `createdAt`.

## Owner (`/vendors/me`), roles CUSTOMER or VENDOR

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | /vendors/me | `{shopName, description?, regionId, districtId, businessPhone, species[]}` | 201 OwnerVendor | 403 if not CUSTOMER (ADMIN), 409 already has a shop, 400 validation / district not in region / empty slug |
| GET | /vendors/me | – | 200 OwnerVendor | 404 `You do not have a shop` |
| PATCH | /vendors/me | partial of POST body | 200 OwnerVendor | 403 suspended, 404, 400 |
| POST | /vendors/me/resubmit | – | 200 OwnerVendor | 409 not REJECTED, 404 |
| PUT | /vendors/me/logo | multipart `file` | 200 OwnerVendor | 400 not JPEG/PNG/WebP or missing file, 413 > 2 MB, 403 suspended, 404 |
| DELETE | /vendors/me/logo | – | 200 OwnerVendor | 403 suspended, 404 |
| GET | /vendors/me/payout-account | – | 200 PayoutAccount | 404 no shop / no payout account |
| PUT | /vendors/me/payout-account | `{method, accountName, provider?, mobileNumber?, bankName?, accountNumber?}` | 200 PayoutAccount | 400 missing or foreign fields, 403 suspended, 404 |

## Public

| Method | Path | Query | Success | Errors |
|---|---|---|---|---|
| GET | /vendors | `page, limit, regionId?, districtId?, species?, search?` | 200 Paginated<PublicVendor>, newest approved first | 400 bad filter |
| GET | /vendors/:slug | – | 200 PublicVendor | 404 not visible |

## Admin (`ADMIN` only; others 403)

| Method | Path | Body / Query | Success | Errors |
|---|---|---|---|---|
| GET | /admin/vendors | `page, limit, status?, search?` (shop name) | 200 Paginated<AdminVendor>, newest submittedAt first | |
| GET | /admin/vendors/:id | – | 200 AdminVendor | 404, 400 bad uuid |
| POST | /admin/vendors/:id/approve | – | 200 AdminVendor | 409 not PENDING / owner deactivated |
| POST | /admin/vendors/:id/reject | `{reason}` (1–500) | 200 AdminVendor | 400 missing reason, 409 not PENDING |
| POST | /admin/vendors/:id/suspend | – | 200 AdminVendor | 409 not APPROVED |
| POST | /admin/vendors/:id/reactivate | – | 200 AdminVendor | 409 not SUSPENDED |

409 message format: `Cannot approve a shop that is APPROVED`.
