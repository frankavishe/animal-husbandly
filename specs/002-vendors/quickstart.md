# Quickstart & Validation: Vendors

## Prerequisites
- Phase 1 environment working (see `specs/001-foundation-auth/quickstart.md`).
- New env keys in `.env` and `.env.test` (see `.env.example`): `S3_ENDPOINT=http://localhost:9100`,
  `S3_REGION=us-east-1`, `S3_BUCKET=vendor-logos`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_PUBLIC_BASE_URL=http://localhost:9100/vendor-logos`, `S3_FORCE_PATH_STYLE=true`.

## Setup
```
docker compose up -d db db_test minio minio-init
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```
MinIO console: http://localhost:9101.

## Automated validation (quality gate)
```
npm run lint && npm run build && npm test && npm run test:e2e
```
E2E uses an in-memory storage fake, so MinIO is not required for tests.

## Manual scenarios (Swagger at http://localhost:<PORT>/docs)
1. **Apply (US1)**: register a customer, then `POST /vendors/me` with Arusha region + an Arusha district,
   species `["CATTLE","GOAT"]` → 201, status PENDING, slug from the name. Repeat → 409.
2. **Reject → resubmit (US1/US2)**: as admin, `POST /admin/vendors/:id/reject {reason}` → REJECTED. As owner,
   `GET /vendors/me` shows the reason. `PATCH` then `POST /vendors/me/resubmit` → PENDING.
3. **Approve (US2)**: admin approves → APPROVED. The owner's next `GET /auth/me` shows role VENDOR, with no re-login.
4. **Public (US3)**: anonymous `GET /vendors?species=CATTLE` lists the shop. `GET /vendors/<slug>` has no
   `payoutAccount`/`rejectionReason`. After an admin suspends it → 404. Reactivate → visible again.
5. **Logo (US4)**: `PUT /vendors/me/logo` with a PNG → `logoUrl` opens from MinIO. A text file renamed `.png`
   → 400. A 3 MB image → 413.
6. **Payout (US4)**: `PUT /vendors/me/payout-account` with MOBILE_MONEY + MPESA + `0754123456` → stored as
   `+255754123456`. Switch to BANK → replaced. Sending BANK with `provider` → 400.

See [contracts/api.md](./contracts/api.md) and [data-model.md](./data-model.md) for the exact shapes and rules.
