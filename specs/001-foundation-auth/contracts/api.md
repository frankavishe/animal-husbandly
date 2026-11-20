# API Contract — Phase 1 (`/api/v1`)

Auth: `Authorization: Bearer <accessToken>` unless marked **public**. Errors always:
`{ "statusCode": 400, "error": "Bad Request", "message": ["..."] | "...", "path": "/api/v1/...", "timestamp": "ISO" }`.
The authoritative, generated contract is the OpenAPI document at `/docs` (JSON at `/docs-json`).

## Auth
| Method | Path | Access | Body | Success |
|---|---|---|---|---|
| POST | /auth/register | public, throttled | `{fullName, phone?, email?, password}` | 201 `AuthResponse` |
| POST | /auth/login | public, throttled | `{identifier, password}` (phone or email) | 200 `AuthResponse` |
| POST | /auth/refresh | public | `{refreshToken}` | 200 `AuthResponse` |
| POST | /auth/logout | public | `{refreshToken}` | 204 |
| POST | /auth/change-password | any role | `{currentPassword, newPassword}` | 204 (other sessions revoked) |
| GET | /auth/me | any role | – | 200 `User` |

`AuthResponse = { accessToken, refreshToken, expiresIn: 900, user: User }`
`User = { id, fullName, phone, email, role, isActive, createdAt }`

Errors: 409 already registered; 401 `Invalid credentials` (generic); 403 `Account deactivated`; 401 invalid/expired/replayed refresh token; 429 throttled.

## Users & addresses
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | /users/me | any role | profile |
| PATCH | /users/me | any role | `{fullName?, phone?, email?}`; `null` clears phone/email (rejected if it removes the last identifier) |
| GET | /regions | public | `[{id, name, code}]` |
| GET | /regions/:id/districts | public | `[{id, name, regionId}]`, 404 unknown region |
| GET | /users/me/addresses | any role | list (default first) |
| POST | /users/me/addresses | any role | `{label, recipientName, contactPhone, regionId, districtId, wardStreet, landmark?, isDefault?}` → 201 |
| GET | /users/me/addresses/:id | any role | 404 if not owner |
| PATCH | /users/me/addresses/:id | any role | partial; 404 if not owner |
| DELETE | /users/me/addresses/:id | any role | 204; promotes newest remaining to default |

## Admin
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | /admin/users | ADMIN | `?page=1&limit=20&role=&isActive=&search=` → `{items, page, limit, total, totalPages}` |
| GET | /admin/users/:id | ADMIN | 404 unknown |
| PATCH | /admin/users/:id/status | ADMIN | `{isActive}`; 400 on own account; deactivation revokes sessions |

## Health
| GET | /health | public | 200 `{status:"ok", info:{database:{status:"up"}}}` / 503 when DB down |
