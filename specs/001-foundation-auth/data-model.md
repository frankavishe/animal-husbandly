# Data Model: Foundation, Authentication & Users

All tables use snake_case names via `@@map`; ids are UUIDs; timestamps `created_at`/`updated_at`.

## Enum `Role`
`CUSTOMER` | `VENDOR` | `ADMIN`

## User (`users`)
| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| fullName | text | 2–100 chars, trimmed |
| phone | text? UNIQUE | E.164 `+255XXXXXXXXX`, valid TZ mobile |
| email | text? UNIQUE | lowercased, valid email |
| passwordHash | text | bcrypt |
| role | Role | default CUSTOMER |
| isActive | bool | default true |
| createdAt / updatedAt | timestamptz | |

Invariant: at least one of `phone`, `email` is non-null (service + DB CHECK constraint).
Index: `(role, is_active)` for admin filtering.

## Session (`sessions`)
| Field | Type | Rules |
|---|---|---|
| id | uuid PK | prefix of the refresh token |
| userId | uuid FK → users (cascade) | indexed |
| tokenHash | text | SHA-256 hex of the secret part |
| expiresAt | timestamptz | now + 7 d |
| usedAt | timestamptz? | set on rotation |
| revokedAt | timestamptz? | set on logout / password change / deactivation / replay |
| userAgent, ip | text? | client info |
| createdAt | timestamptz | |

State: `active` (usedAt null, revokedAt null, not expired) → `used` (rotated) or `revoked`. Presenting a non-active
session's token → 401; if it was `used` or `revoked` → revoke all of the user's sessions.

## Region (`regions`)
| id int PK | name text UNIQUE | code text UNIQUE |

## District (`districts`)
| id int PK | name text | regionId int FK → regions | UNIQUE(regionId, name) |

## Address (`addresses`)
| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK → users (cascade) | indexed |
| label | text | 1–50 chars (e.g. "Home") |
| recipientName | text | 2–100 chars |
| contactPhone | text | normalised TZ mobile |
| regionId | int FK → regions | |
| districtId | int FK → districts | must belong to regionId |
| wardStreet | text | 2–200 chars |
| landmark | text? | ≤ 200 chars |
| isDefault | bool | at most one true per user (partial unique index) |
| createdAt / updatedAt | timestamptz | |

Rules: first address is default; setting a new default unsets the old in one transaction; deleting the default
promotes the most recently created remaining address.
