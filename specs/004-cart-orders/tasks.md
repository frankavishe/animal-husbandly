---
description: "Task list for Phase 4 — Cart & Orders"
---

# Tasks: Cart & Orders

**Input**: Design documents from `/specs/004-cart-orders/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Required by Constitution VI. Every service gets unit tests, every endpoint group gets e2e tests, and money, stock and status rules are tested under simultaneous requests.

Format: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel (different file, no dependency on an incomplete task).

## Phase 1: Setup

No new dependencies.

- [x] T001 Add `ORDER_EXPIRY_INTERVAL_MS` to `src/config/env.validation.ts` (`Joi.number().integer().min(0).max(600000).default(300000)`, and to `AppConfig`) with a case in the existing config spec in `src/config/`; document it in `.env.example` (`0` = off) and set it to `0` in `.env.test`
- [x] T002 [P] Export `AddressesService` from `src/users/users.module.ts` (no behaviour change)

## Phase 2: Foundational (blocks all stories)

- [x] T003 Add enums `SubOrderStatus`, `PaymentMethod`, `OrderActorType` and models `Cart`, `CartItem`, `Order`, `SubOrder`, `OrderItem`, `SubOrderStatusHistory` to `prisma/schema.prisma`, with the exact fields, snake_case maps, unique keys, indexes and delete rules of `data-model.md`:
  - `Cart`/`CartItem` foreign keys Cascade; every foreign key from the four order tables **Restrict**
  - `total`, `subtotal`, `lineTotal` are `BigInt`; `seq Int @unique @default(autoincrement())`
  - Unique: `carts(user_id)`, `cart_items(cart_id, listing_id)`, `orders(customer_id, submission_key)`, `sub_orders(order_id, vendor_id)`, `order_items(sub_order_id, listing_id)`
- [x] T004 Create migration `prisma/migrations/<ts>_cart_orders/migration.sql` (`prisma migrate dev --create-only`), append the six CHECKs, apply to dev and test databases, regenerate the client:
  - `cart_items_quantity`: quantity 1–1,000,000 and last_seen_price 1–1,000,000,000
  - `orders_total` and `sub_orders_subtotal`: 1–10,000,000,000
  - `sub_orders_cash_collected`: `(status = 'DELIVERED') = (cash_collected_at IS NOT NULL)`
  - `order_items_line_total`: unit_price 1–1e9, quantity 1–1e6, `line_total = unit_price::bigint * quantity`
  - `sub_order_history_actor`: `(actor_type = 'MARKETPLACE') = (actor_id IS NULL)` and reason null or ≤ 500 characters
- [x] T005 Create pure `src/orders/order-status.ts` and `src/orders/order-status.spec.ts`:
  - `TRANSITIONS` keyed by actor and action with `from[]`, `to` and whether a reason is `required`, `optional` or `none`, exactly the data-model table; `OPEN_STATUSES` = PENDING, CONFIRMED, DISPATCHED
  - `returnsStock(from, to)`: true only for from PENDING/CONFIRMED and to REJECTED/CANCELLED
  - `overallStatus(statuses)` and `overallStatusWhere(status): Prisma.OrderWhereInput` (R8); `orderNumber(seq)` → `ORD-` + at least 8 digits; constants `MAX_ORDER_TOTAL = 10_000_000_000n`, `MAX_OPEN_ORDERS = 10`, `RESPONSE_LIMIT_HOURS = 48`, `ORDER_TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 }`
  - Spec: every status × actor × action, every overall status combination, number padding
- [x] T006 Create `src/listings/listing-stock.service.ts` and `src/listings/listing-stock.service.spec.ts`, exported from `src/listings/listings.module.ts`; all methods take a `Prisma.TransactionClient`:
  - `lockForSale(tx, ids)`: bound `$queryRaw` `SELECT id … ORDER BY id FOR NO KEY UPDATE`, then re-read listing, stock, price, shop and an `available` flag (ACTIVE and the `PUBLIC_VENDOR_WHERE` rule)
  - `take(tx, listingId, quantity)`: `updateMany` with `stockQuantity: { gte: quantity }` and a decrement; count 0 throws 409
  - `giveBack(tx, items)`: sorted by listing id, bound `$executeRaw` `stock_quantity = LEAST(stock_quantity + q, 1000000)`, `updated_at = now()`; never touches status
- [x] T007 Create `src/orders/sub-order-transitions.service.ts` and `src/orders/sub-order-transitions.service.spec.ts`: `apply({ subOrderId, where, actorType, actorId, action, reason })` in one `$transaction` with `ORDER_TX_OPTIONS`:
  - Lock the sub-order `FOR UPDATE` (scoped by `where`; none → 404 `Order not found`); status not in `from` → 409 `Cannot <action> an order that is <STATUS>`
  - Update status (DELIVERED also sets `cashCollectedAt`), append one history row, call `giveBack` when `returnsStock`
  - Spec: history and stock for each transition; DISPATCHED → CANCELLED returns nothing; 404 and 409 change nothing
- [x] T008 Create `src/cart/cart.module.ts` and `src/orders/orders.module.ts` (imports Cart, Listings, Users, Vendors; provides `SubOrderTransitionsService`) and register both in `src/app.module.ts`
- [x] T009 [P] Extend `test/utils.ts`: `resetUsers` first deletes history, order items, sub-orders, orders, cart items and carts; add helpers `createAddress`, `addToCart`, `checkout` (builds lines from `GET /cart`, random `submissionKey`), `placeOrder`, `getStock`

**Checkpoint**: migration applied, unit tests of the pure rules pass, existing e2e suites still green.

## Phase 3: User Story 1: Fill my cart (P1)

**Goal**: One private cart per customer or vendor, grouped by shop, with flags.
**Independent test**: Add from two shops, change, remove, check totals; price change and pause are flagged; stock never changes.

- [x] T010 [P] [US1] Create `src/cart/dto/index.ts`: `AddCartItemDto` (`listingId` UUID, `quantity` int 1–1,000,000), `SetCartItemDto` (`quantity` int 1–1,000,000), and `CartDto` with nested response classes matching the contract, all with Swagger decorators
- [x] T011 [P] [US1] Create `src/cart/cart.mapper.ts` and `src/cart/cart.mapper.spec.ts`: flags `UNAVAILABLE`, `SHORT_OF_STOCK`, `PRICE_CHANGED`; unavailable lines have null price, total and stock and are excluded from totals; group by shop; sums in `bigint`; `exceedsMaxTotal` compared as `bigint`. Spec includes 50 lines of 1e15 and an exact key whitelist
- [x] T012 [US1] Create `src/cart/cart.service.ts` (exported from `src/cart/cart.module.ts`): `get`, `add`, `set`, `remove`, `clear`:
  - Writes upsert the cart, lock it `FOR UPDATE` (bound `$queryRaw`) and run in one transaction with the same 10 s limits
  - `add`: listing not visible → 404 `Listing not found`; own shop → 403 `You cannot buy from your own shop`; stock 0 → 409 out of stock; existing + quantity above stock → 409 naming the stock, line unchanged; 51st line → 409
  - `set`: not in cart → 404; same visibility and stock checks. `add` and `set` update `lastSeenPrice`; `remove` and `clear` work on unavailable lines
- [x] T013 [US1] Create `src/cart/cart.controller.ts` (`@Roles(CUSTOMER, VENDOR)`): `GET /cart`, `DELETE /cart`, `POST /cart/items` (200), `PATCH /cart/items/:listingId`, `DELETE /cart/items/:listingId`, all returning `CartDto` with Swagger responses; register in `src/cart/cart.module.ts`
- [x] T014 [US1] Unit tests in `src/cart/cart.service.spec.ts` for every rule in T012
- [x] T015 [US1] E2E in `test/cart.e2e-spec.ts`: US1 scenarios 1–9; simultaneous adds of one listing give one combined line within stock; 51st line; admin 403 and anonymous 401; another user's cart unaffected; stock unchanged throughout; unavailable lines expose no moderation details

## Phase 4: User Story 2: Place an order (P1)

**Goal**: All-or-nothing, idempotent cash-on-delivery checkout split per shop.
**Independent test**: Two-shop checkout gives one order, two sub-orders, reduced stock and an empty cart; repeats and races are safe.

- [ ] T016 [P] [US2] Create `src/orders/dto/checkout.dto.ts`: `CheckoutDto` (`addressId` UUID, `submissionKey` UUID, `lines` 1–50, nested-validated, distinct by `listingId`) and `CheckoutLineDto` (`listingId` UUID, `quantity` int 1–1,000,000, `unitPrice` int 1–1,000,000,000); and `src/orders/dto/order-response.dto.ts` with the shared and `CustomerOrderDto` shapes; export from `src/orders/dto/index.ts`
- [ ] T017 [P] [US2] Create `src/orders/order.mapper.ts` and `src/orders/order.mapper.spec.ts`: `orderInclude`, `toCustomerOrder` (bigint → number; ADMIN shown as `MARKETPLACE`; no actor ids; `reason` from the last history entry). Spec asserts exact keys
- [x] T018 [US2] Add `lockForCheckout(tx, userId)`, `loadLines(tx, cartId)` and `empty(tx, cartId)` to `src/cart/cart.service.ts`
- [ ] T019 [US2] Create `src/orders/checkout.service.ts`: `checkout(userId, dto)` in one `$transaction` with `ORDER_TX_OPTIONS`, in this order:
  - Lock cart; look up `(customerId, submissionKey)`: same SHA-256 hash of address id + lines sorted by listing id → return that order; different → 409
  - 10 OPEN orders → 409 naming the limit; empty cart → 400; `AddressesService.get` → 404 `Address not found`
  - `lockForSale`; collect every problem (missing, extra, different quantity or price, unavailable, short stock, own shop) → 409 `message: string[]` in the contract's wording; total above `MAX_ORDER_TOTAL` → 409
  - `take` each line; create order with address copy (region and district names), sub-orders with shop name copy, items, and placement history (`fromStatus` null, CUSTOMER); empty the cart
- [ ] T020 [US2] Create `src/orders/orders.service.ts` (`get(userId, id)`, others' → 404 `Order not found`) and `src/orders/orders.controller.ts` (`@Roles(CUSTOMER, VENDOR)`) with `POST /orders` (201) and `GET /orders/:id`, with Swagger responses; register in `src/orders/orders.module.ts`
- [ ] T021 [US2] Unit tests in `src/orders/checkout.service.spec.ts`: check order, hash independent of line order, replay vs conflict, every problem type, several problems reported together, compensating price changes, total at and above the limit, per-shop split and sums
- [ ] T022 [US2] E2E in `test/orders.e2e-spec.ts`: US2 scenarios 1–3 and 5–9; failed checkouts leave stock, cart and orders unchanged and the key reusable; replay after the address is deleted and at the open-order limit; order unchanged after listing edit, archive and address change; total = Σ subtotals = Σ items; raw-SQL violations of all six CHECKs rejected; deleting an ordered listing, its shop, or the buyer is rejected by the database
- [ ] T023 [US2] E2E races in `test/order-races.e2e-spec.ts`: 50 buyers for stock 10 → exactly 10 × 201, 40 × 409, stock 0, no 5xx (SC-002; insert the buyers' users, carts and addresses directly, and raise the Jest timeout); same key sent 5 times at once → one order; two keys at 9 OPEN orders → at most one; carts holding the same two listings added in opposite order → no deadlock or 5xx
- [ ] T024 [P] [US2] FR-032 regression in `test/listings.e2e-spec.ts`: `PATCH` without `stockQuantity` leaves stock unchanged, also when sent together with a checkout

## Phase 5: User Story 3: Fulfil my shop's orders (P1)

**Goal**: Vendors progress, reject or cancel their own sub-orders.
**Independent test**: One sub-order to DELIVERED, one rejected with stock returned; another vendor sees neither.

- [ ] T025 [P] [US3] Add `VendorOrderDto`, its paginated class, `VendorListOrdersQueryDto` (`status?: SubOrderStatus`) and `OrderReasonDto` (`@IsReason()`) in `src/orders/dto/vendor-order.dto.ts`, and `toVendorOrder` in `src/orders/order.mapper.ts` with spec (no order total, other shops, customer account or actor ids)
- [ ] T026 [US3] Create `src/orders/vendor-orders.service.ts`: `list` (newest first, then id, paginated), `get`, `confirm`, `dispatch`, `deliver`, `reject`, `cancel`, using `VendorsService.findMine` (any shop status) and `SubOrderTransitionsService` scoped by `vendorId`
- [ ] T027 [US3] Create `src/orders/vendor-orders.controller.ts` (`@Roles(VENDOR)`, `vendors/me/orders`): the 7 contract routes, actions returning 200, with Swagger responses; register in `src/orders/orders.module.ts`
- [ ] T028 [US3] Unit tests in `src/orders/vendor-orders.service.spec.ts`: scoping, filters, each action's arguments
- [ ] T029 [US3] E2E in `test/vendor-orders.e2e-spec.ts`: US3 scenarios 1–9; response key whitelist; suspended shop can progress, reject and cancel; customer and admin 403; returned stock on ARCHIVED, INACTIVE and TAKEN_DOWN listings keeps their status and is capped at 1,000,000; simultaneous confirm and reject → one 200, one 409

## Phase 6: User Story 4: Follow and cancel my orders (P2)

**Goal**: Order history, cancellation of PENDING parts, 48-hour expiry.
**Independent test**: Two-shop order, cancel one part, deliver the other; statuses, history and stock are right.

- [ ] T030 [US4] Add `CustomerListOrdersQueryDto` (`status?` OPEN/COMPLETED/CANCELLED) and `CancelSubOrderDto` (`reason?` trimmed string ≤ 500, blank treated as none) in `src/orders/dto/customer-order.dto.ts`; `list` and `cancelSubOrder` (scoped by order and customer) in `src/orders/orders.service.ts`; `GET /orders` and `POST /orders/:id/sub-orders/:subOrderId/cancel` (200) in `src/orders/orders.controller.ts`
- [ ] T031 [US4] Create `src/orders/order-expiry.service.ts`, registered in `src/orders/orders.module.ts`: `run()` pages PENDING sub-orders with `createdAt` ≥ 48 h ago by id cursor (batches of 100) and applies the MARKETPLACE expire action with reason `The shop did not respond in time`; conflicts skipped, other errors logged and skipped; logs expired and failed counts. Runs at application bootstrap and every `ORDER_EXPIRY_INTERVAL_MS` (0 = neither), never overlapping, `unref`'d timer cleared on shutdown
- [ ] T032 [US4] Unit tests in `src/orders/orders.service.spec.ts` (list filters, cancel scope) and `src/orders/order-expiry.service.spec.ts` (cutoff, paging past failures, no overlap, off at 0, timer cleared)
- [ ] T033 [US4] E2E in `test/customer-orders.e2e-spec.ts`: US4 scenarios 1–7, with `created_at` backdated and `OrderExpiryService.run()` called directly; 47 h is not expired; two simultaneous `run()` calls, cancel-vs-confirm, double cancel and expire-vs-confirm return stock at most once; expiry with a suspended shop and with deactivated owner or customer; admin actor never exposed

## Phase 7: User Story 5: Admin oversees orders (P3)

**Goal**: Admins find any order and cancel undelivered parts.
**Independent test**: Filter orders; cancelling CONFIRMED returns stock, DISPATCHED does not; both parties see the reason.

- [ ] T034 [US5] Create `src/orders/dto/admin-order.dto.ts` (`AdminOrderDto`, paginated class, `AdminListOrdersQueryDto`: `status?, subOrderStatus?, vendorId?, customerId?, from?, to?` ISO dates), `toAdminOrder` in `src/orders/order.mapper.ts` with spec, and `src/orders/orders-admin.service.ts` (`list`, `get`, `cancelSubOrder`), exported from `src/orders/orders.module.ts`. `from` after `to` → 400; `to` includes its whole day; `subOrderStatus` with `vendorId` must match the same sub-order
- [ ] T035 [US5] Create `src/admin/admin-orders.controller.ts` (`@Roles(ADMIN)`, `admin/orders`) with the 3 contract routes and Swagger responses; import `OrdersModule` in `src/admin/admin.module.ts`
- [ ] T036 [US5] Unit tests in `src/orders/orders-admin.service.spec.ts`: filter composition, date bounds, cancel arguments
- [ ] T037 [US5] E2E in `test/admin-orders.e2e-spec.ts`: US5 scenarios 1–5 including every filter; stock returned for PENDING and CONFIRMED and not for DISPATCHED; admin and time recorded; customer and vendor see the reason with actor `MARKETPLACE`

## Phase 8: Polish

- [ ] T038 [P] Add a Cart & Orders section and Phase 4 to `README.md`, extend the Swagger description in `src/app.setup.ts`, and add every new path to the `/docs-json` check in `test/foundation.e2e-spec.ts` (SC-008)
- [ ] T039 Check SC-007 with a throwaway script outside the repository (10,000 seeded orders in a disposable database, 100 concurrent users; cart, checkout and order pages p95 < 1 s); record the result in `specs/004-cart-orders/quickstart.md`
- [ ] T040 Run `npm run lint`, `npm run build`, `npm test` and `npm run test:e2e`, then the manual scenarios in `specs/004-cart-orders/quickstart.md`, timing one purchase (SC-001 < 2 minutes); report actual results

## Dependencies

- Setup (T001–T002) → Foundational (T003–T009) → US1 (T010–T015) → US2 (T016–T024) → US3, US4 and US5, which are independent of each other after US2 because transitions and stock are foundational. Their e2e tests use `SubOrderTransitionsService` directly (from the app) to reach statuses owned by another story.
- T003 → T004 → T005 → T006 → T007 → T008. T002 blocks T019. T001 blocks T031. T009 blocks all e2e tasks.
- Within each story: DTOs and mapper → service → controller → unit tests → e2e.

## Parallel examples

- Setup: T001 and T002. Foundational: T009 alongside T005–T008 (after T004).
- US1: T010 and T011. US2: T016 and T017; T024 alongside T021.
- After US2: US3, US4 and US5 in parallel; merge carefully in `order.mapper.ts`, `dto/index.ts` and `orders.module.ts`.

## Implementation strategy

1. MVP = Setup + Foundational + US1 + US2 + US3: buyers can order and shops can fulfil.
2. Add US4 (history, cancellation, expiry), then US5 (admin). Do not release before US4: without expiry, ignored orders hold stock.
3. Commit after each phase, and run the full quality gate (T040) before owner sign-off.
