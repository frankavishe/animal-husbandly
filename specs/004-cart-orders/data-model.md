# Data Model — Phase 4 Cart & Orders

Existing entities used: `User`, `Vendor`, `Listing`, `Address`. New migration: `cart_orders`.

## Enums

| Enum | Values |
|------|--------|
| `SubOrderStatus` | `PENDING`, `CONFIRMED`, `DISPATCHED`, `DELIVERED`, `REJECTED`, `CANCELLED` |
| `PaymentMethod` | `CASH_ON_DELIVERY` |
| `OrderActorType` | `CUSTOMER`, `VENDOR`, `ADMIN`, `MARKETPLACE` |

Overall order status (`OPEN`, `COMPLETED`, `CANCELLED`) is derived, not stored (R8).

## Cart (`carts`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| userId | uuid → users.id | unique, onDelete Cascade |
| createdAt / updatedAt | timestamptz | |

Locked `FOR UPDATE` by every cart write and checkout (R2).

## CartItem (`cart_items`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| cartId | uuid → carts.id | onDelete Cascade |
| listingId | uuid → listings.id | onDelete Cascade; unique with cartId |
| quantity | int | 1–1,000,000 |
| lastSeenPrice | int | price when last added to or changed |
| createdAt / updatedAt | timestamptz | |

At most 50 per cart, enforced under the cart lock. Index `(listing_id)`.

Flags are computed: `UNAVAILABLE` (listing not ACTIVE, shop not APPROVED or owner inactive; excluded from totals),
`SHORT_OF_STOCK` (stock < quantity), `PRICE_CHANGED` (price ≠ lastSeenPrice).

## Order (`orders`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| seq | int autoincrement, unique | shown as `ORD-00000001` |
| customerId | uuid → users.id | Restrict |
| recipientName, contactPhone, regionName, districtName, wardStreet | text | address copy |
| landmark | text? | address copy |
| paymentMethod | `PaymentMethod` | default CASH_ON_DELIVERY |
| total | bigint | 1–10,000,000,000 |
| submissionKey | uuid | unique with customerId |
| submissionHash | text | SHA-256 of address id + sorted lines |
| createdAt | timestamptz | placement time |

Indexes: `(customer_id, created_at)`, `(created_at)`.

## SubOrder (`sub_orders`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| orderId | uuid → orders.id | Restrict; unique with vendorId |
| vendorId | uuid → vendors.id | Restrict |
| shopName | text | copy |
| subtotal | bigint | 1–10,000,000,000 |
| status | `SubOrderStatus` | default PENDING |
| cashCollectedAt | timestamptz? | set exactly when DELIVERED |
| createdAt / updatedAt | timestamptz | createdAt equals the order's; starts the 48 h limit |

Indexes: `(vendor_id, status)`, `(status, created_at)`.

## OrderItem (`order_items`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| subOrderId | uuid → sub_orders.id | Restrict; unique with listingId |
| listingId | uuid → listings.id | Restrict; used to return stock |
| title | text | copy |
| species, listingType, unit | enums | copy |
| unitPrice | int | copy |
| quantity | int | 1–1,000,000 |
| lineTotal | bigint | unitPrice × quantity |

Index: `(listing_id)`.

## SubOrderStatusHistory (`sub_order_status_history`)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| subOrderId | uuid → sub_orders.id | Restrict |
| fromStatus | `SubOrderStatus`? | null for placement |
| toStatus | `SubOrderStatus` | |
| actorType | `OrderActorType` | |
| actorId | uuid? → users.id | Restrict; null exactly for MARKETPLACE |
| reason | text? | ≤ 500 |
| createdAt | timestamptz | |

Append-only. Index: `(sub_order_id, created_at)`. The rejection or cancellation reason shown on a sub-order is the one on
its last entry.

## CHECK constraints (migration, raw SQL)

| Name | Rule | FR |
|------|------|----|
| `cart_items_quantity` | quantity 1–1e6, last_seen_price 1–1e9 | FR-003 |
| `orders_total` | total 1–1e10 | FR-016 |
| `sub_orders_subtotal` | subtotal 1–1e10 | FR-016 |
| `sub_orders_cash_collected` | `(status = 'DELIVERED') = (cash_collected_at IS NOT NULL)` | FR-019 |
| `order_items_line_total` | unit_price 1–1e9, quantity 1–1e6, `line_total = unit_price::bigint * quantity` | FR-016 |
| `sub_order_history_actor` | `(actor_type = 'MARKETPLACE') = (actor_id IS NULL)`; reason ≤ 500 | FR-030 |

That subtotal = Σ line totals and total = Σ subtotals spans rows; the checkout computes both from the same lines and
tests assert it (SC-006).

## State transitions

| Action | Actor | From | To | Reason | Stock |
|--------|-------|------|----|--------|-------|
| place | customer | – | PENDING | – | taken |
| confirm | vendor | PENDING | CONFIRMED | – | – |
| dispatch | vendor | CONFIRMED | DISPATCHED | – | – |
| deliver | vendor | DISPATCHED | DELIVERED | – | – (sets cashCollectedAt) |
| reject | vendor | PENDING | REJECTED | required | returned |
| cancel | vendor | CONFIRMED | CANCELLED | required | returned |
| cancel | customer | PENDING | CANCELLED | optional | returned |
| cancel | admin | PENDING, CONFIRMED | CANCELLED | required | returned |
| cancel | admin | DISPATCHED | CANCELLED | required | **not** returned |
| expire | marketplace | PENDING ≥ 48 h | CANCELLED | `The shop did not respond in time` | returned |

Anything else → 409 naming the current status. Returned stock is capped at 1,000,000 and never changes listing status.

## Visibility

- **Cart**: its owner only. **Customer**: own orders; admin and automatic actions shown as `MARKETPLACE`, no actor ids.
- **Vendor**: own shop's sub-orders in any shop status; no customer account, other shops or order total.
  Actor ids are hidden; administrators are shown as `MARKETPLACE`.
- **Admin**: everything.
