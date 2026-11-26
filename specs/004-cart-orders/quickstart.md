# Quickstart & Validation: Cart & Orders

Shapes and status codes: [contracts/api.md](./contracts/api.md). Transitions: [data-model.md](./data-model.md).

## Prerequisites
- Phase 3 environment working (see `specs/003-listings/quickstart.md`).
- Optional new env key `ORDER_EXPIRY_INTERVAL_MS` (default 300000; `0` in `.env.test`).
- Dev database on 5434, test database on 5435; pick a free `PORT` if 3000 is taken.

## Setup
```
docker compose up -d db db_test minio minio-init
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

## Automated validation (quality gate)
```
npm run lint && npm run build && npm test && npm run test:e2e
```
E2E includes the 50-buyer race, replayed and simultaneous submissions, the open-order limit race, cancel-vs-confirm,
backdated expiry, and deletes blocked by existing orders.

## Manual scenarios (Swagger at http://localhost:<PORT>/docs)
Use two approved shops A and B with published listings (stock 10 and 5), a customer with a saved address, and the admin.

1. **Cart (US1)**: `POST /cart/items` for A (3) and B (1) → two shop groups, correct totals. Add A +2 → 5; +6 → 409, still
   5. `PATCH` quantity 0 → 400. Vendor A adding their own listing → 403. Admin → 403. Listing stock is unchanged.
2. **Flags (US1)**: vendor A changes the price, vendor B pauses → `PRICE_CHANGED` with `previousPrice`; `UNAVAILABLE` and
   left out of the total. Re-activate B.
3. **Checkout (US2)**: `POST /orders` with A's old price → 409 naming the line. With current lines → 201, two PENDING
   sub-orders, stock 5 and 4, empty cart. Same request again → the same order, stock unchanged. Same key with another
   address → 409.
4. **Copies (US2)**: edit the listing title and delete the address → `GET /orders/:id` is unchanged.
5. **Limit (US2)**: with 10 OPEN orders, `POST /orders` → 409; cancel one fully → accepted.
6. **Fulfil (US3)**: vendor A confirm → dispatch → deliver → DELIVERED with `cashCollectedAt`; `deliver` on a PENDING one →
   409. Vendor B `reject` without a reason → 400; with one → REJECTED, stock back. A CONFIRMED order `cancel` with a reason
   → stock back; a DISPATCHED one → 409. Vendor B opening A's sub-order → 404. No order total or customer account shown.
7. **Suspended shop (US3)**: admin suspends A → vendor A can still progress existing orders.
8. **Customer (US4)**: cancel a PENDING sub-order → stock back, the other part unaffected; cancel a CONFIRMED one → 409.
   Order status becomes COMPLETED or CANCELLED as in FR-023.
9. **Expiry (US4)**: in the dev database set a PENDING sub-order's `created_at` back 49 hours and restart the app →
   CANCELLED by MARKETPLACE, stock back.
10. **Admin (US5)**: filter `GET /admin/orders`; cancel a CONFIRMED sub-order → stock back; a DISPATCHED one → stock
    unchanged; missing reason → 400. The customer sees the actor as MARKETPLACE.
