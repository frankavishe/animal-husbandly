# Quickstart & Validation — Phase 1

## Prerequisites
Node.js 24, npm, Docker with Compose.

## Setup
```bash
cp .env.example .env            # fill secrets
docker compose up -d            # db (5432) + db_test (5433)
npm install
npx prisma migrate deploy
npx prisma db seed              # 31 regions + districts, admin from ADMIN_* env
npm run start:dev
```

## Validation scenarios
1. Docs: open http://localhost:3000/docs — every endpoint in [contracts/api.md](./contracts/api.md) is listed.
2. Health: `GET /api/v1/health` → 200 with database `up`; `docker compose stop db` → 503 with database `down`.
3. Config: unset `JWT_ACCESS_SECRET` and start → process exits naming `JWT_ACCESS_SECRET`.
4. US1: register with phone `0712345678` → stored as `+255712345678`; log in with phone and with email; refresh; replay old refresh → 401 and all sessions revoked; logout.
5. US2: list regions (31), districts of a region; create two addresses, second default; delete default → promotion.
6. US3: log in as seeded admin; list/search users; deactivate a customer → their next request 403/401; reactivate.

## Quality gate
```bash
npm run lint && npm run build && npm test && npm run test:e2e
```
