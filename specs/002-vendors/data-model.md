# Data Model: Vendors

## Enums

| Enum | Values |
|---|---|
| `VendorStatus` | PENDING, APPROVED, REJECTED, SUSPENDED |
| `Species` | CATTLE, GOAT, SHEEP, PIG, CHICKEN, FISH (Constitution II) |
| `PayoutMethod` | MOBILE_MONEY, BANK |
| `MobileMoneyProvider` | MPESA, MIXX_BY_YAS, AIRTEL_MONEY, HALOPESA |

## Vendor (`vendors`)

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| userId (`user_id`) | uuid, **unique**, FK users ON DELETE CASCADE | one shop per user (FR-002) |
| shopName (`shop_name`) | text | 2–80 chars, trimmed |
| slug | text **unique** | generated once, ≤ 60 chars + suffix, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| description | text | ≤ 1000 chars |
| regionId / districtId | int FK, ON DELETE RESTRICT | district belongs to region (service check) |
| businessPhone (`business_phone`) | text | `+255XXXXXXXXX` |
| species | `Species[]` | ≥ 1 (CHECK `cardinality(species) >= 1`), unique values (DTO `ArrayUnique`) |
| logoKey (`logo_key`) | text? | object key in bucket |
| status | `VendorStatus` default PENDING | |
| rejectionReason (`rejection_reason`) | text? | ≤ 500; set on reject, cleared on resubmit |
| submittedAt (`submitted_at`) | timestamptz | set on apply and resubmit |
| reviewedById (`reviewed_by_id`) | uuid? FK users ON DELETE SET NULL | last admin action |
| reviewedAt (`reviewed_at`) | timestamptz? | |
| createdAt / updatedAt | timestamptz | |

Indexes: `status`, `region_id`, GIN on `species` (raw SQL).

Relations: `User 1—0..1 Vendor` (owner, relation name `VendorOwner`); `User 1—* Vendor` as reviewer
(relation `VendorReviewer`); `Region`/`District 1—* Vendor`; `Vendor 1—0..1 VendorPayoutAccount`.

## VendorPayoutAccount (`vendor_payout_accounts`)

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| vendorId (`vendor_id`) | uuid **unique**, FK vendors ON DELETE CASCADE | |
| method | `PayoutMethod` | |
| provider | `MobileMoneyProvider`? | required iff MOBILE_MONEY |
| mobileNumber (`mobile_number`) | text? | `+255…`, required iff MOBILE_MONEY |
| bankName (`bank_name`) | text? | 2–100 chars, required iff BANK |
| accountNumber (`account_number`) | text? | 6–30 digits as text, required iff BANK |
| accountName (`account_name`) | text | 2–100 chars, always |
| createdAt / updatedAt | timestamptz | |

CHECK `payout_method_fields`:
```
(method = 'MOBILE_MONEY' AND provider IS NOT NULL AND mobile_number IS NOT NULL AND bank_name IS NULL AND account_number IS NULL)
OR (method = 'BANK' AND bank_name IS NOT NULL AND account_number IS NOT NULL AND provider IS NULL AND mobile_number IS NULL)
```

## State transitions (Vendor.status)

```
apply ──► PENDING ──approve──► APPROVED ──suspend──► SUSPENDED
             │                    ▲                      │
           reject                 └─────reactivate───────┘
             ▼
          REJECTED ──resubmit (owner)──► PENDING
```

| Action | Actor | From | To | Side effects |
|---|---|---|---|---|
| apply | CUSTOMER (no shop) | – | PENDING | slug, submittedAt |
| approve | ADMIN | PENDING | APPROVED | owner.role = VENDOR (same tx); owner must be active; reviewedBy/At |
| reject | ADMIN | PENDING | REJECTED | rejectionReason; reviewedBy/At |
| suspend | ADMIN | APPROVED | SUSPENDED | reviewedBy/At |
| reactivate | ADMIN | SUSPENDED | APPROVED | reviewedBy/At |
| resubmit | owner | REJECTED | PENDING | rejectionReason = null; submittedAt = now |

Any other (action, status) pair → 409 `Cannot <action> a shop that is <STATUS>`.
Owner edits (profile, logo, payout) allowed in PENDING, REJECTED, APPROVED; SUSPENDED → 403.

## Visibility

Public = `status = APPROVED AND owner.isActive = true`.
