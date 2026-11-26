# API Contract — Phase 4 Cart & Orders (`/api/v1`)

Auth, error shape and pagination envelope (`{items, page, limit, total, totalPages}`) are as in Phase 1.
The authoritative contract is `/docs` (`/docs-json`). All money is whole TZS as JSON integers. All `:id`s are UUIDs
(400 otherwise).

## Shapes

```
CartLine  = { listingId, title, unit: ListingUnit, quantity, unitPrice: int|null, lineTotal: int|null,
              stockLeft: int|null, previousPrice: int|null,
              flags: ("UNAVAILABLE"|"SHORT_OF_STOCK"|"PRICE_CHANGED")[] }
Cart      = { shops: [{ shop:{slug, shopName}, lines: CartLine[], subtotal }],
              total, lineCount, exceedsMaxTotal: boolean }

Address   = { recipientName, contactPhone, regionName, districtName, wardStreet, landmark: string|null }
OrderItem = { listingId, title, species, listingType, unit, unitPrice, quantity, lineTotal }
History   = { fromStatus: SubOrderStatus|null, toStatus, actor: "CUSTOMER"|"VENDOR"|"MARKETPLACE",
              reason: string|null, createdAt }
SubOrder  = { id, shopName, status, subtotal, items: OrderItem[], reason: string|null,
              cashCollectedAt: string|null, history: History[], updatedAt }

CustomerOrder = { id, orderNumber, status: "OPEN"|"COMPLETED"|"CANCELLED", paymentMethod, total,
                  deliveryAddress: Address, subOrders: (SubOrder + { shopSlug })[], createdAt }
VendorOrder   = SubOrder + { orderNumber, paymentMethod, deliveryAddress: Address, createdAt }
AdminOrder    = { id, orderNumber, status, paymentMethod, total, deliveryAddress, createdAt,
                  customer: { id, fullName, phone, email },
                  subOrders: (SubOrder + { vendor:{id, slug, shopName}, history entries with
                              actor also "ADMIN" and actorUser:{id, fullName}|null })[] }
```

For an `UNAVAILABLE` line `unitPrice`, `lineTotal` and `stockLeft` are null and the line is excluded from totals.
`previousPrice` is set only with `PRICE_CHANGED`.

## Cart (roles CUSTOMER, VENDOR)

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | /cart | – | 200 Cart (empty when never used) | |
| DELETE | /cart | – | 200 Cart (empty) | |
| POST | /cart/items | `{ listingId, quantity }` (adds to an existing line) | 200 Cart | 400 invalid quantity, 403 own shop, 404 listing not visible, 409 out of stock / above stock / 50 lines |
| PATCH | /cart/items/:listingId | `{ quantity }` (replaces) | 200 Cart | 400, 404 not in cart or listing not visible, 409 above stock |
| DELETE | /cart/items/:listingId | – | 200 Cart | 404 not in cart |

## Customer orders (roles CUSTOMER, VENDOR)

| Method | Path | Body / Query | Success | Errors |
|---|---|---|---|---|
| POST | /orders | `{ addressId, submissionKey: uuid, lines: [{ listingId, quantity, unitPrice }] }` (1–50, distinct listings) | 201 CustomerOrder (also when replayed) | 400 invalid body or empty cart, 404 address, 409 see below |
| GET | /orders | `page, limit, status?` (overall) | 200 Paginated<CustomerOrder>, newest first | |
| GET | /orders/:id | – | 200 CustomerOrder | 404 |
| POST | /orders/:id/sub-orders/:subOrderId/cancel | `{ reason? }` (≤ 500) | 200 CustomerOrder | 404, 409 not PENDING |

409 from `POST /orders`: submission key reused with a different address or lines; 10 open orders; total above
10,000,000,000; or `message: string[]` with one entry per problem line, e.g.
`"Boran heifer" (<listingId>): price is now 1300000 (you confirmed 1200000)`,
`… only 2 left (you asked for 3)`, `… is no longer available`, `… is in your cart but was not confirmed`,
`Listing <listingId> is not in your cart`.

## Vendor orders (role VENDOR; `:id` is the sub-order; any shop status)

| Method | Path | Body / Query | Success | Errors |
|---|---|---|---|---|
| GET | /vendors/me/orders | `page, limit, status?` (sub-order) | 200 Paginated<VendorOrder>, newest first | 404 no shop |
| GET | /vendors/me/orders/:id | – | 200 VendorOrder | 404 |
| POST | /vendors/me/orders/:id/confirm | – | 200 VendorOrder | 404, 409 not PENDING |
| POST | /vendors/me/orders/:id/dispatch | – | 200 VendorOrder | 404, 409 not CONFIRMED |
| POST | /vendors/me/orders/:id/deliver | – | 200 VendorOrder | 404, 409 not DISPATCHED |
| POST | /vendors/me/orders/:id/reject | `{ reason }` (1–500) | 200 VendorOrder | 400, 404, 409 not PENDING |
| POST | /vendors/me/orders/:id/cancel | `{ reason }` (1–500) | 200 VendorOrder | 400, 404, 409 not CONFIRMED |

409 message format: `Cannot deliver an order that is PENDING`.

## Admin (`ADMIN` only; others 403)

| Method | Path | Body / Query | Success | Errors |
|---|---|---|---|---|
| GET | /admin/orders | `page, limit, status?` (overall), `subOrderStatus?, vendorId?, customerId?, from?, to?` (ISO dates, inclusive) | 200 Paginated<AdminOrder>, newest first | 400 from after to |
| GET | /admin/orders/:id | – | 200 AdminOrder | 404 |
| POST | /admin/orders/:id/sub-orders/:subOrderId/cancel | `{ reason }` (1–500) | 200 AdminOrder | 400, 404, 409 DELIVERED / REJECTED / CANCELLED |

`subOrderStatus` together with `vendorId` matches orders where that shop's sub-order has that status.

19 endpoints. Configuration: `ORDER_EXPIRY_INTERVAL_MS` (0–600000, default 300000, 0 = off).
