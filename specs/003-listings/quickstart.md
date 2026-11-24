# Quickstart & Validation: Listings

## Prerequisites
- Phase 2 environment working (see `specs/002-vendors/quickstart.md`), including MinIO. No new env keys.

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
Unit tests cover all 24 species × type combinations; e2e includes a raw-SQL insert of goat MILK that must be
rejected by the database. E2E uses the in-memory storage fake, so MinIO is not required for tests.

## Manual scenarios (Swagger at http://localhost:<PORT>/docs)
1. **Vendor ready**: apply for a shop with species `["CATTLE","CHICKEN"]` and approve it as admin
   (Phase 2 quickstart steps 1 and 3).
2. **Create (US1)**: `POST /vendors/me/listings` LIVE_ANIMAL CATTLE, unit HEAD, unitPrice 1200000,
   stockQuantity 3, breed "Boran", sex FEMALE, ageMonths 30, weightKg 350.5 → 201 DRAFT.
3. **Domain rules (US1)**: GOAT + MILK → 400 (and GOAT is not a shop species → 400 either way); CATTLE + EGGS
   → 400; CHICKEN + EGGS unit TRAY → 201; MILK with unit KG → 400; MEAT with `breed` → 400.
4. **Lifecycle (US2)**: `POST …/:id/publish` → ACTIVE; `…/pause` → INACTIVE; `…/activate` → ACTIVE;
   `…/pause` on a DRAFT → 409 naming DRAFT. `PATCH` species on the ACTIVE listing → 409.
5. **Public (US3)**: anonymous `GET /listings?species=CATTLE&minPrice=100000&sort=price_desc` returns the
   cattle listing; `GET /listings/:id` shows `shop` summary and no `status`/`takenDownReason`. A DRAFT id → 404.
6. **Photos (US4)**: `POST …/:id/photos` with three images → `photos` positions 0–2, `coverUrl` = first.
   `PUT …/photos/order` reversing the ids → cover changes. Text file renamed `.jpg` → 400; 6 MB image → 413;
   a sixth photo → 409.
7. **Moderation (US5)**: admin `POST /admin/listings/:id/take-down {reason}` → TAKEN_DOWN; public `GET` → 404;
   vendor sees `takenDownReason`; vendor publish/activate → 409. Admin `…/restore` → INACTIVE; vendor
   activates → ACTIVE.
8. **Shop suspended**: admin suspends the shop → its listings vanish publicly; vendor `PATCH` → 403, `pause`
   still works. Reactivate shop → listings visible again.

See [contracts/api.md](./contracts/api.md) and [data-model.md](./data-model.md) for the exact shapes and rules.
