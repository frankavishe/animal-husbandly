# Research — Phase 4 Cart & Orders

No open `NEEDS CLARIFICATION` items remained after `/speckit-clarify`. The decisions below settle the technical
choices the spec leaves to planning.

## R1. Money types

- **Decision**: `unit_price` copies stay `INTEGER`. `line_total`, `subtotal` and `total` are `BIGINT`, summed as
  `bigint` in code and converted to JSON numbers in the mappers.
- **Rationale**: FR-016 allows order totals to 1e10, above int32. Every stored amount is ≤ 1e10, well inside 2^53, so the
  JSON number is exact. Principle III (integers only) holds.
- **Cart totals** are not stored and not capped. A line can reach 1e15 (exact), and 50 such lines 5e16 (above 2^53). This
  is only possible far above the order maximum, so the cart returns `exceedsMaxTotal: true` and checkout is refused; the
  comparison with the maximum is made on the `bigint`, never on the converted number.
- **Alternatives**: `Decimal` → no benefit for whole TZS; strings in JSON → inconsistent with listing prices.

## R2. Serialising one user's cart and checkout

- **Decision**: One `carts` row per user, created on first use (`INSERT … ON CONFLICT DO NOTHING` via upsert). Every cart
  write and checkout first locks it with `SELECT … FOR UPDATE` in its transaction.
- **Rationale**: Gives combined quantities for simultaneous adds, the 50-line limit, idempotent replay and the 10-order
  limit a single lock. Unique constraints remain as a backstop.
- **Alternatives**: SERIALIZABLE with retries → retry code everywhere; unique constraints alone → cannot express limits.

## R3. Never overselling

- **Decision**: In a READ COMMITTED transaction: lock the listing rows `FOR NO KEY UPDATE ORDER BY id`, re-read listing and
  shop visibility, price and stock, validate, then decrement conditionally (`stock_quantity >= quantity`), expecting one
  row each.
- **Rationale**: Waiting buyers see the committed stock. A fixed lock order prevents deadlocks. `NO KEY UPDATE` does not
  block the key-share locks that cart and order item inserts take on listings. The conditional update and the existing
  `listings_ranges` CHECK are backstops.
- **Alternatives**: Conditional decrement only → cannot report every problem line; optimistic versions → retries.

## R4. Transaction time limits

- **Decision**: Checkout and transitions use `{ maxWait: 10_000, timeout: 10_000 }`.
- **Rationale**: Prisma's interactive defaults (2 s to get a connection, 5 s to run) would turn SC-002's 50 simultaneous
  checkouts, queued on one row, into server errors.

## R5. Idempotent submission

- **Decision**: `submissionKey` (UUID) in the body; orders store it with a SHA-256 fingerprint of the address id and the
  lines sorted by listing id. Looked up right after the cart lock, before any other check. Same fingerprint → the original
  order; different → 409. Unique `(customer_id, submission_key)`.
- **Rationale**: FR-013. Checking first lets a replay succeed with the now-empty cart, a deleted address, or at the open
  order limit. A failed checkout rolls back, so its key is unused.
- **Alternatives**: `Idempotency-Key` header → not covered by the DTO validation convention; separate key table → nothing
  to store beyond the order.

## R6. Confirmed lines and error reporting

- **Decision**: `lines[]` must match the cart exactly by listing, quantity and current price. All problems (missing, extra,
  different quantity or price, unavailable, short stock, own shop) are collected and returned as 409 with
  `message: string[]`, one entry per problem, naming title, listing id and current values. Titles of listings that are
  no longer visible come from the cart (the buyer already saw them), never moderation details.
- **Rationale**: FR-010/011. The existing filter passes arrays unchanged, so the one error shape (Principle IV) is kept.
  Clients refresh structured values with `GET /cart`.
- **Alternatives**: A `details` object on errors → changes the shared shape for one endpoint.

## R7. Order numbers

- **Decision**: Autoincrement integer `seq` shown as `ORD-` plus at least 8 zero-padded digits.
- **Rationale**: Unique without retries and easy to read over the phone. Numbers reveal rough order volume; they grant no
  access because every lookup is by UUID and owner.
- **Alternatives**: Random codes → collision retries inside a transaction.

## R8. Overall status

- **Decision**: Derived. A pure function for responses; relation filters for lists: OPEN = some sub-order in
  PENDING/CONFIRMED/DISPATCHED; COMPLETED = none of those and some DELIVERED; CANCELLED = none of those and none DELIVERED.
- **Rationale**: Cannot drift from the sub-orders. Indexes support it at 10,000 orders.

## R9. Status changes

- **Decision**: One `SubOrderTransitionsService.apply()` used by vendor, customer, admin and expiry: lock the sub-order row
  `FOR UPDATE`, check the action's allowed `from`, update, add a history entry, and return stock when `from` is PENDING or
  CONFIRMED and `to` is REJECTED or CANCELLED. Otherwise 409 `Cannot <action> an order that is <STATUS>`.
- **Rationale**: FR-028–030 in one place. The lock (rather than Phase 3's conditional `updateMany`) is needed because an
  admin cancel must know which status it came from to decide on stock and history.
- **Restock**: per listing in id order, `stock_quantity = LEAST(stock_quantity + q, 1000000)`; listing status untouched.
  Sub-order locked before listings; checkout never locks existing sub-orders, so there is no lock cycle.

## R10. Expiry of unanswered sub-orders

- **Decision**: `OrderExpiryService` runs at startup and every `ORDER_EXPIRY_INTERVAL_MS` (default 300000, `0` = off, off
  in `.env.test`). It pages through PENDING sub-orders created ≥ 48 h ago by id cursor, one `apply()` transaction each. A
  conflict (someone acted first) is skipped; another error is logged and skipped. Runs never overlap in one process; the
  timer is cleared on shutdown. Logs expired and failed counts.
- **Rationale**: Every 5 minutes satisfies the 15-minute bound; the startup run covers downtime. The row lock makes several
  instances safe. The joi maximum of 600000 keeps configuration within the bound.
- **Alternatives**: `@nestjs/schedule` → a dependency for one interval; BullMQ/Redis → belongs to the notifications phase.

## R11. Orders outlive everything else

- **Decision**: Copy address, shop name and item details at checkout; region and district as names. All foreign keys from
  order tables are `ON DELETE RESTRICT`; the address is copied with no foreign key.
- **Rationale**: FR-015/031. RESTRICT also stops the current user → vendor → listing cascade for anything ever ordered.
  Address deletion stays free.
- **History permanence** (FR-030): no service or route updates or deletes history. A database trigger was rejected: tests
  must clear tables, and no other code path exists.

## R12. Module boundaries

- **Decision**: `ListingStockService` (listings) owns locking, taking and returning stock and receives the caller's
  `Prisma.TransactionClient`. `CartService` exports lock/load/empty in the same style. `UsersModule` exports
  `AddressesService`.
- **Rationale**: Principle I (exported services only) together with Principle III (one transaction).

## R13. Vendor stock edits

- **Decision**: No change. `ListingsService.updateMine` writes `stockQuantity` only when sent, so FR-032 already holds; add
  a regression test. An explicit value is the vendor's declared remaining stock (spec edge case).
