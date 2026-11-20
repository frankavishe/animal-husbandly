# Feature Specification: Foundation, Authentication & Users

**Feature Branch**: `001-foundation-auth`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Phase 1 — Foundation, authentication & users for the Animal Husbandry Marketplace backend (multi-vendor, Tanzania, TZS). Scope: project foundation (versioned API, database, validated configuration, request validation, consistent errors, API docs, health check); authentication (register with full name, +255 phone and/or email, password; login with phone or email; short-lived access + rotating refresh token; logout; password change; roles CUSTOMER/VENDOR/ADMIN; register as CUSTOMER only; seeded ADMIN; role-based access for later modules); users (own profile, delivery addresses using seeded Tanzania regions/districts, admin list users and activate/deactivate). Out of scope: vendors, listings, cart, orders, payments, notifications, OTP/SMS verification, social login."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an account and sign in (Priority: P1)

A farmer's customer in Tanzania (e.g. a butcher, hotel buyer or household) creates an account using their
full name, a Tanzanian mobile number and/or an email address, and a password. They then sign in using
either identifier and stay signed in across sessions until they log out.

**Why this priority**: Every later capability (buying, selling, paying) requires a known, authenticated
user. Without it nothing else in the marketplace can be built or tested.

**Independent Test**: Register a new user, sign in with phone, sign in with email, call a protected
"who am I" operation, refresh the session, and log out — all without any other module present.

**Acceptance Scenarios**:

1. **Given** no account exists for `+255712345678`, **When** a visitor registers with full name, that
   phone and a valid password, **Then** an account is created with role CUSTOMER and the visitor
   receives a signed-in session.
2. **Given** a registered user, **When** they sign in with their phone (or email) and correct password,
   **Then** they receive a short-lived access credential and a refresh credential.
3. **Given** a signed-in user whose access credential has expired, **When** they present a valid refresh
   credential, **Then** they receive a new pair and the old refresh credential stops working.
4. **Given** a signed-in user, **When** they log out, **Then** their refresh credential can no longer be
   used.
5. **Given** a registration attempt with a phone or email already in use, **When** it is submitted,
   **Then** it is rejected with a clear "already registered" message.
6. **Given** a sign-in attempt with a wrong password, **When** submitted, **Then** it is rejected with a
   generic "invalid credentials" message that does not reveal whether the account exists.

---

### User Story 2 - Manage my profile and delivery addresses (Priority: P2)

A signed-in user views and edits their profile (name, email, phone) and keeps a list of delivery
addresses in Tanzania — choosing a region and district from the official list, entering ward/street,
a landmark and a contact phone — with one address marked as default for future orders.

**Why this priority**: Live animals and fresh products must be delivered to real locations; addresses
are needed before ordering (Phase 3) but have no value without accounts (P1).

**Independent Test**: As a signed-in user, list regions and districts, create two addresses, set the
second as default, edit and delete an address, and view/update the profile.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they request the list of regions, **Then** all seeded Tanzania
   regions are returned, and for a chosen region its districts are returned.
2. **Given** a signed-in user, **When** they add an address with a district that does not belong to the
   chosen region, **Then** it is rejected.
3. **Given** a user with one address, **When** they add a second address marked default, **Then** the
   new address becomes default and the previous one is no longer default.
4. **Given** a user's first address, **When** it is created, **Then** it is automatically the default.
5. **Given** a user, **When** they try to view or change another user's address, **Then** the request is
   refused as not found.
6. **Given** a signed-in user, **When** they change their password supplying the correct current
   password, **Then** the new password works for sign-in and all their other sessions are signed out.

---

### User Story 3 - Administer user accounts (Priority: P3)

A platform administrator (created during initial setup) lists and searches users, views a user's
details, and deactivates or reactivates an account — e.g. to stop a fraudulent buyer.

**Why this priority**: Needed for trust and safety, but the marketplace can be exercised without it.

**Independent Test**: Sign in as the seeded admin, list users with pagination and search, deactivate a
customer, confirm the customer can no longer sign in or refresh, then reactivate them.

**Acceptance Scenarios**:

1. **Given** the seeded admin, **When** they list users, **Then** they get a paginated list filterable by
   role, active status and a search term (name, phone or email).
2. **Given** an active customer, **When** the admin deactivates them, **Then** the customer's existing
   sessions are revoked and future sign-ins are refused with an "account deactivated" message.
3. **Given** a deactivated customer, **When** the admin reactivates them, **Then** they can sign in again.
4. **Given** a CUSTOMER, **When** they attempt any admin operation, **Then** it is refused as forbidden.
5. **Given** an admin, **When** they attempt to deactivate their own account, **Then** it is refused.

---

### User Story 4 - Operable, documented platform foundation (Priority: P1)

The platform owner and future client developers can start the backend locally with one command for the
database, see interactive documentation of every operation, and check system health.

**Why this priority**: It is the base every phase builds on; misconfiguration must fail fast.

**Independent Test**: Start the database and API, open the documentation page, call the health check,
then start the API with a missing required setting and confirm it refuses to start.

**Acceptance Scenarios**:

1. **Given** the database is running, **When** the health check is called, **Then** it reports the API and
   database as up.
2. **Given** the database is stopped, **When** the health check is called, **Then** it reports the
   database as down with an unhealthy status.
3. **Given** a required configuration value is missing, **When** the API starts, **Then** it exits with a
   message naming the missing value.
4. **Given** any request with invalid or unexpected fields, **When** submitted, **Then** it is rejected
   with a consistent error structure listing the problems.

### Edge Cases

- Phone numbers entered as `0712345678`, `712345678` or `+255 712 345 678` are normalised to
  `+255712345678`; numbers that are not valid Tanzanian mobile numbers are rejected.
- Emails are compared case-insensitively (`Juma@Mail.com` equals `juma@mail.com`).
- Registration with neither phone nor email is rejected.
- A refresh credential that was already used (replayed) is rejected, and all sessions of that user are
  revoked as a precaution.
- Removing the user's only identifier (e.g. clearing email when no phone exists) is rejected.
- Deleting the default address promotes the most recently created remaining address to default.
- Repeated failed sign-ins are throttled to slow down password guessing.
- A deactivated user holding a still-valid access credential is refused on their next request.

## Requirements *(mandatory)*

### Functional Requirements

**Foundation**

- **FR-001**: System MUST expose all operations under a versioned base path (`/api/v1`).
- **FR-002**: System MUST validate all required configuration at startup and refuse to start if any is
  missing or invalid.
- **FR-003**: System MUST validate every request payload and reject unknown fields.
- **FR-004**: System MUST return every error in one consistent structure (status code, error name,
  message(s), path, timestamp).
- **FR-005**: System MUST publish interactive documentation for every operation at `/docs`.
- **FR-006**: System MUST provide a public health check reporting API and database status.
- **FR-007**: System MUST provide seed data: all Tanzania regions with their districts, and one initial
  administrator whose credentials come from configuration.

**Authentication**

- **FR-008**: Visitors MUST be able to register with full name, password, and at least one of phone
  number or email.
- **FR-009**: System MUST accept only valid Tanzanian mobile numbers, stored in `+255XXXXXXXXX` form, and
  MUST keep phone numbers and emails unique across accounts.
- **FR-010**: Passwords MUST be at least 8 characters and contain at least one letter and one digit;
  they MUST be stored only in irreversibly hashed form.
- **FR-011**: All self-registered accounts MUST receive role CUSTOMER; no visitor can self-assign VENDOR
  or ADMIN.
- **FR-012**: Users MUST be able to sign in with phone or email plus password.
- **FR-013**: Sign-in MUST issue a short-lived access credential (15 minutes) and a refresh credential
  (valid 7 days).
- **FR-014**: Refresh MUST rotate credentials: each refresh credential is single-use; reuse of a spent
  one revokes all of that user's sessions.
- **FR-015**: Users MUST be able to log out, revoking the current refresh credential.
- **FR-016**: Users MUST be able to change their password by supplying the current one; this revokes all
  their other sessions.
- **FR-017**: System MUST provide role-based access control (CUSTOMER, VENDOR, ADMIN) that any operation
  can declare, and MUST refuse operations to users lacking the role.
- **FR-018**: Deactivated users MUST NOT be able to sign in, refresh, or use existing access credentials.
- **FR-019**: System MUST throttle repeated sign-in and registration attempts from the same client
  (max 10 per minute).

**Users & addresses**

- **FR-020**: Signed-in users MUST be able to view their own profile (id, name, phone, email, role,
  status, created date) and update name, phone and email (subject to uniqueness and the
  at-least-one-identifier rule).
- **FR-021**: Any user MUST be able to list Tanzania regions and the districts of a region.
- **FR-022**: Signed-in users MUST be able to create, list, view, update and delete their own delivery
  addresses (label, recipient name, contact phone, region, district, ward/street, landmark, default flag).
- **FR-023**: System MUST ensure each user has at most one default address; the first address is default
  automatically.
- **FR-024**: Users MUST NOT be able to see or modify other users' addresses.
- **FR-025**: Administrators MUST be able to list users with pagination, filter by role and active
  status, and search by name, phone or email.
- **FR-026**: Administrators MUST be able to view any user and activate/deactivate any account except
  their own; deactivation revokes all that user's sessions.

### Key Entities

- **User**: a person using the marketplace. Full name, phone (optional, unique), email (optional,
  unique), hashed password, role (CUSTOMER / VENDOR / ADMIN), active flag, timestamps.
- **Session (Refresh credential)**: a revocable sign-in session belonging to a user; hashed token,
  expiry, revoked/used state, client info, timestamps.
- **Region**: an official Tanzania region (name, code).
- **District**: an administrative district belonging to exactly one region.
- **Address**: a delivery location owned by a user; label, recipient, contact phone, region, district,
  ward/street, landmark, default flag.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can register and be signed in within 1 minute using only a phone number.
- **SC-002**: 100% of registrations with invalid phone numbers, duplicate identifiers or weak passwords
  are rejected with a message explaining the reason.
- **SC-003**: A deactivated account is unable to perform any signed-in action within 1 request after
  deactivation.
- **SC-004**: A replayed refresh credential never yields a new session (verified by automated tests).
- **SC-005**: 100% of operations in this phase appear in the interactive documentation.
- **SC-006**: All 31 Tanzania mainland and Zanzibar regions are available for address selection.
- **SC-007**: Sign-in, profile and address operations respond in under 1 second for 95% of requests
  under normal load (100 concurrent users).

## Assumptions

- Phone/email ownership verification (OTP, email links) and "forgot password" are out of scope for this
  phase because SMS/email delivery arrives in a later phase; an admin can deactivate abusive accounts.
- VENDOR role exists now but is only granted through vendor onboarding in Phase 2.
- Users are not hard-deleted; deactivation is the only removal mechanism in this phase.
- Region/district data covers the 31 regions of Tanzania (26 mainland + 5 Zanzibar) and their districts
  as currently published; wards are entered as free text.
- Client applications (web/mobile) are built separately and consume this backend.
- Default sizes: pagination 20 items per page, maximum 100.
