# Implementation Plan: Cart & Orders

**Branch**: `004-cart-orders` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-cart-orders/spec.md`

## Summary

Add a cart and cash-on-delivery orders. Each CUSTOMER or VENDOR has one cart of up to 50 visible listings, with lines
flagged when unavailable, short of stock or repriced. Checkout confirms every line, and in one transaction locks the
cart and listings, re-checks everything, takes stock, copies address and item details, and creates one order with one
sub-order per shop. Submission keys make it idempotent; a customer may have 10 OPEN orders. Vendors confirm, dispatch,
deliver, reject or cancel (before dispatch); customers cancel PENDING parts; admins cancel any undelivered part; PENDING
parts expire after 48 hours. Stock returns exactly once from PENDING or CONFIRMED and never from DISPATCHED. No online
payments, commission, fees or notifications.

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 24 LTS

**Primary Dependencies**: Existing stack only (NestJS 11, Prisma 6, class-validator, @nestjs/swagger). No new
dependencies.

**Storage**: PostgreSQL 16 (6 new tables, 3 new enums, raw CHECK constraints). Order totals are BIGINT whole TZS.

**Testing**: Jest unit tests with mocked Prisma (every status × actor × action; cart flags; checkout problems; mapper
whitelists; expiry). Jest + supertest e2e against `db_test`, including concurrency tests with simultaneous requests.

**Target Platform**: Linux/Windows server, container-friendly

**Project Type**: web-service (backend only)

**Performance Goals**: p95 < 1 s for cart, checkout and order pages at 100 concurrent users with 10,000 orders (SC-007);
50 simultaneous checkouts of one listing resolve without server errors (SC-002). Indexes in data-model.md.

**Constraints**: 50 cart lines; quantity 1–1,000,000; order total ≤ 10,000,000,000 TZS; 10 OPEN orders per customer;
expiry within 15 minutes of 48 hours; reasons ≤ 500 characters. Pagination default 20, max 100.

**Scale/Scope**: 19 new endpoints (5 cart, 4 customer, 7 vendor, 3 admin), 6 tables, 1 migration, 1 optional env key.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Modular NestJS | PASS | New `cart` and `orders` modules, both in the constitution's list. Stock changes only through exported `ListingStockService`, cart access from checkout through exported `CartService`, addresses through `AddressesService`, shops through `VendorsService.findMine`. Relation filters and foreign keys refer to other modules' models, as `PUBLIC_VENDOR_WHERE` already does. Admin hosts only the controller. Bound raw SQL is justified below. |
| II. Domain Integrity | PASS | No catalogue rules change. Items copy species and type from listings that already satisfy the constraints. |
| III. Money Safety | PASS | Integers only (INTEGER/BIGINT, summed as bigint). Checkout, cancellation, rejection, expiry and delivery each run in one transaction. Order amounts are never updated; status history is append-only. |
| IV. API Contract First | PASS | `/api/v1`, Swagger on all routes, whitelisting DTOs, unchanged error shape (`message: string[]` for line problems), paginated lists. |
| V. Security by Default | PASS | Every route declares `@Roles`; carts, orders and sub-orders are filtered by owner, foreign ids → 404. Explicit mappers hide actor ids and customer accounts. The environment key is validated at startup. |
| VI. Test Discipline | PASS | Unit tests for every service, e2e for all four endpoint groups, concurrency and DB constraint tests. |
| VII. Phased Delivery | PASS | One payment method value, no provider interface, ledger or scheduler library. |

Post-design re-check: PASS (no new violations beyond Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/004-cart-orders/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma                        # + 3 enums, Cart, CartItem, Order, SubOrder, OrderItem, SubOrderStatusHistory
└── migrations/<ts>_cart_orders/         # + CHECK constraints
src/
├── config/env.validation.ts             # + ORDER_EXPIRY_INTERVAL_MS
├── users/users.module.ts                # export AddressesService
├── listings/
│   ├── listing-stock.service.ts (+ .spec)   # lock / take / giveBack in the caller's transaction
│   └── listings.module.ts               # export ListingStockService
├── cart/
│   ├── cart.module.ts                   # exports CartService
│   ├── cart.service.ts (+ .spec)        # view, add, set, remove, clear; lock/load/empty for checkout
│   ├── cart.mapper.ts (+ .spec)         # flags, grouping, totals
│   ├── cart.controller.ts               # /cart
│   └── dto/
├── orders/
│   ├── orders.module.ts                 # imports Cart, Listings, Users, Vendors; exports OrdersAdminService
│   ├── checkout.service.ts (+ .spec)
│   ├── order-status.ts (+ .spec)        # transition table, derived status and filters (pure)
│   ├── sub-order-transitions.service.ts (+ .spec)
│   ├── orders.service.ts (+ .spec)      # customer queries and cancel
│   ├── vendor-orders.service.ts (+ .spec)
│   ├── orders-admin.service.ts (+ .spec)
│   ├── order-expiry.service.ts (+ .spec)
│   ├── order.mapper.ts (+ .spec)        # customer / vendor / admin shapes
│   ├── orders.controller.ts             # /orders
│   ├── vendor-orders.controller.ts      # /vendors/me/orders
│   └── dto/
├── admin/
│   ├── admin-orders.controller.ts       # /admin/orders
│   └── admin.module.ts                  # imports OrdersModule
├── app.setup.ts                         # Swagger description mentions cart and orders
└── app.module.ts                        # + CartModule, OrdersModule
test/
├── utils.ts                             # resetUsers clears order tables first; cart/order helpers
├── cart.e2e-spec.ts
├── orders.e2e-spec.ts                   # checkout, history, races, expiry, RESTRICT, CHECKs
├── vendor-orders.e2e-spec.ts
├── admin-orders.e2e-spec.ts
└── listings.e2e-spec.ts                 # + FR-032 regression
.env.example, .env.test, README.md       # new key; Cart & Orders section
```

**Structure Decision**: Same single NestJS project. Checkout is in `orders` and calls `cart`, `listings` and `users`
through exported services, passing its transaction. Vendor routes stay under `/vendors/me/`, admin routes in `admin`,
as in Phases 2 and 3.

## Requirement Coverage

| Requirements | Where |
|---|---|
| FR-001–007 | `cart` module; R2; CartItem flags |
| FR-008–016, 010a | `checkout.service.ts`; R1–R7 |
| FR-017–021 | `vendor-orders.service.ts`, transitions; R9 |
| FR-022–025 | `orders.service.ts`, mappers; R8 |
| FR-024a | `order-expiry.service.ts`; R10 |
| FR-026–027 | `orders-admin.service.ts` |
| FR-028–030 | `sub-order-transitions.service.ts`; R9, R11 |
| FR-031 | RESTRICT foreign keys and copies; R11 |
| FR-032 | existing `ListingsService.updateMine` + regression test; R13 |
| FR-033 | all controllers and DTOs |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `$queryRaw` row locks (cart, listings, sub-order), bound parameters | FR-012, FR-013, FR-010a and FR-028 under concurrency | Prisma has no `SELECT … FOR UPDATE`; serializable isolation needs retries everywhere |
| `$executeRaw` capped restock, bound parameters | FR-029 limit of 1,000,000 | Prisma's `increment` cannot cap and would break `listings_ranges` |
| Raw SQL CHECK constraints in the migration | Principle III integrity for amounts and status fields | Prisma schema cannot express CHECK constraints |
| In-process timer for expiry | FR-024a | A scheduler library or queue adds a dependency for one job |
