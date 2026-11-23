# Research: Vendors

## Object storage client
- **Decision**: `@aws-sdk/client-s3` (v3) with `forcePathStyle: true` and a configurable `endpoint`. The
  app uses an abstract `StorageService` (`put`, `delete`, `publicUrl`) with an `S3StorageService`
  implementation. Public URL = `${S3_PUBLIC_BASE_URL}/${key}`.
- **Rationale**: One SDK works with MinIO locally and with AWS S3, Cloudflare R2 or Wasabi in production.
  The abstract class doubles as the DI token, so e2e can swap in an in-memory fake.
- **Alternatives**: `minio` JS client (MinIO-specific), presigned direct uploads (more client complexity;
  content sniffing would have to happen after upload).

## Local object storage
- **Decision**: `minio/minio` service on host ports 9100 (API) and 9101 (console), plus a one-shot
  `minio/mc` `minio-init` service that creates bucket `vendor-logos` with anonymous download.
- **Rationale**: Ports 9000 and 9001 are often taken, and this machine already has conflicts on
  3000/3100/5432. Public-read means logo URLs work without presigning.
- **Alternatives**: Presigned GET URLs (expire, so they're not cacheable by clients); serving through
  the API (extra load).

## Upload handling
- **Decision**: `FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 MB } })`.
  Multer's `LIMIT_FILE_SIZE` maps to 413 Payload Too Large in the controller layer. Content type is
  detected with a small magic-byte helper:
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47 0D 0A 1A 0A`
  - WebP: `RIFF....WEBP`
- **Rationale**: The client MIME type and extension are untrusted (SC-005). A 2 MB cap makes memory
  storage safe. A hand-written sniffer avoids the ESM-only `file-type` package in a CommonJS Nest build.
- **Alternatives**: `file-type` (ESM-only in recent versions), `sharp` re-encode (heavy native dependency;
  resizing is out of scope).

## Logo replacement atomicity
- **Decision**: Upload the new object under a fresh key `vendors/<vendorId>/logo-<uuid>.<ext>`, then
  update `logoKey` in the DB, then delete the old object on a best-effort basis (log failures).
- **Rationale**: FR-021 says a failed upload leaves the old logo intact. An orphaned old object is
  harmless, whereas a dangling DB pointer is not.

## Slug generation
- **Decision**: NFKD-normalise, strip diacritics and apostrophes, lowercase, turn non-alphanumerics into
  `-`, collapse/trim dashes, cap at 60 characters. On collision, query existing slugs with the
  `base`/`base-N` prefix and pick max N + 1. The unique index is the final guard: on P2002, retry once
  with the next suffix. An empty slug → 400.
- **Rationale**: Deterministic, readable slugs (FR-005); race-safe through the unique constraint (edge case).

## Approval atomicity and role effect
- **Decision**: `prisma.$transaction` with a conditional `updateMany({ where: { id, status: PENDING } })`;
  a count of 0 → 409 with the current status. Then `user.update({ role: VENDOR })` in the same transaction.
  The Phase 1 `JwtStrategy` already reads the role from the DB on every request, so SC-002 holds without
  a re-login.
- **Rationale**: The conditional update prevents double-approval races. One transaction satisfies FR-011.

## Status transition table
- **Decision**: A single map `{approve: PENDING→APPROVED, reject: PENDING→REJECTED, suspend: APPROVED→SUSPENDED, reactivate: SUSPENDED→APPROVED, resubmit: REJECTED→PENDING}` applied through the same
  conditional-update helper.
- **Rationale**: One place to test every valid and invalid transition (SC-003).

## Payout account validation
- **Decision**: The DTO uses `@IsEnum(method)` plus `@ValidateIf(o => o.method === 'MOBILE_MONEY')` for
  provider and mobileNumber, and `@ValidateIf(o => o.method === 'BANK')` for bankName and accountNumber.
  The service additionally refuses fields from the other method (400). The DB CHECK mirrors both rules.
  Mobile numbers are normalised with the existing `normalizeTzPhone`.
- **Rationale**: FR-025 requires validation-level and storage-level enforcement.

## Public visibility filter
- **Decision**: `where: { status: APPROVED, user: { isActive: true } }` for both the list and get-by-slug,
  and a dedicated `PublicVendorDto` mapper that whitelists fields (FR-019).
- **Rationale**: A positive whitelist mapper makes accidental leakage of new columns impossible (SC-004).
