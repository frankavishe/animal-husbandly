# Research: Foundation, Authentication & Users

## Configuration validation
- **Decision**: `@nestjs/config` with a Joi `validationSchema`, `abortEarly: false`.
- **Rationale**: Built-in support; the error message names every missing/invalid key (FR-002).
- **Alternatives**: zod (needs custom glue), class-validator env class (more boilerplate).

## Refresh token design
- **Decision**: Opaque 256-bit random token (`crypto.randomBytes(32)` base64url), prefixed with the session id
  (`<sessionId>.<secret>`). Stored as SHA-256 hash. Each refresh marks the session `usedAt` and creates a new
  one in a transaction. A presented token whose session is already used/revoked → revoke all sessions of the
  user and respond 401.
- **Rationale**: SHA-256 is adequate for high-entropy random tokens (bcrypt unnecessary); the session-id prefix
  makes lookup O(1) and lets replay of a spent token be detected (FR-014, SC-004).
- **Alternatives**: JWT refresh tokens (harder to revoke individually); bcrypt-hashed tokens (slow, needs lookup key anyway).

## Access token & deactivation
- **Decision**: JWT (HS256) 15 min with `sub`, `role`, `sid`. `JwtStrategy.validate` loads the user and rejects
  inactive users, and uses the DB role (not the token's) for authorization.
- **Rationale**: SC-003 requires deactivation to take effect within one request; one indexed PK lookup per request is cheap.

## Password hashing
- **Decision**: `bcrypt`, cost 10 (configurable `BCRYPT_ROUNDS`, tests use 4).
- **Rationale**: Constitution V mandates bcrypt.

## Phone normalisation
- **Decision**: `libphonenumber-js` with default country `TZ`; accept only `MOBILE` (or `FIXED_LINE_OR_MOBILE`) numbers whose country is TZ; store E.164.
- **Rationale**: Handles `0712…`, `712…`, `+255 712 …` reliably; rejects non-TZ numbers.

## Email uniqueness
- **Decision**: Lowercase + trim at the DTO transform layer and in the service; normal unique index.
- **Alternatives**: `citext` extension (extra migration complexity for no gain).

## Throttling
- **Decision**: `@nestjs/throttler` registered globally with a named `auth` limit (10/min) applied via `@Throttle` on register/login; other routes not throttled in this phase. Limit configurable via env so e2e can test it.

## Health check
- **Decision**: `@nestjs/terminus` with `PrismaHealthIndicator`; returns 503 when the DB ping fails.

## Logging
- **Decision**: `nestjs-pino` with request logging; redact `req.headers.authorization`, `password`, `currentPassword`, `newPassword`, `refreshToken`.

## Regions & districts data
- **Decision**: Static TypeScript data file of 31 regions (26 mainland + 5 Zanzibar) with their council districts, seeded via idempotent upserts keyed by region code / `(regionId, name)`.

## E2E database
- **Decision**: Separate `db_test` Postgres service on port 5433; `test/global-setup.ts` runs `prisma migrate deploy` + the idempotent seed once via Jest `globalSetup` (non-destructive; `db_test` is a tmpfs container), and suites delete non-admin users/sessions/addresses before running. `migrate reset` was rejected because it is destructive and Prisma blocks it from AI agents without explicit consent.
