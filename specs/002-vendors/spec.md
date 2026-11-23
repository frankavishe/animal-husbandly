# Feature Specification: Vendors

**Feature Branch**: `002-vendors`

**Created**: 2026-11-23

**Status**: Implemented

**Input**: User description: "Phase 2 — Vendors for the Animal Husbandry Marketplace backend (Tanzania, TZS). Scope: (US1, P1) a signed-in CUSTOMER applies to open a shop: shop name (unique slug generated), description, region + district (seeded TZ data), business phone (+255), species dealt in (at least one of CATTLE, GOAT, SHEEP, PIG, CHICKEN, FISH); application starts PENDING; owner can view/edit own shop while PENDING, REJECTED or APPROVED; editing a REJECTED shop then resubmitting returns it to PENDING; SUSPENDED shops cannot be edited; one shop per user. (US2, P1) ADMIN lists/filters/searches vendor applications by status, views detail including payout account, approves (PENDING→APPROVED, user role becomes VENDOR atomically, effective on next request), rejects with mandatory reason, suspends (APPROVED→SUSPENDED) and reactivates; invalid transitions are refused with a clear conflict message. (US3, P2) anyone (no sign-in) lists approved shops of active owners, paginated, filterable by region, district, species and name search, and views one shop by slug; hidden shops are not found; public view never exposes payout details, rejection reasons or reviewer info. (US4, P2) owner uploads/replaces/removes a shop logo (JPEG/PNG/WebP, max 2 MB, content verified, stored in S3-compatible object storage — MinIO locally) and sets a payout account: either MOBILE_MONEY (provider MPESA, MIXX_BY_YAS, AIRTEL_MONEY or HALOPESA, +255 number, account name) or BANK (bank name, account number, account name); payout details visible only to owner and admins; no money moves in this phase. Out of scope: listings, cart, orders, payout execution, commission, KYC document uploads, notifications."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Apply to open a shop and manage it (Priority: P1)

A signed-in customer — a livestock keeper, a butcher or a poultry farmer — applies to sell on the
marketplace by describing their shop: a shop name, a short description, where they operate (region and
district from the official Tanzania list), a business phone number and which species they deal in. The
application waits for platform review. While it waits, or after it is approved, the owner can view and
correct their shop details. If it is rejected, they see the reason, fix the details and resubmit.

**Why this priority**: Without vendors there is nothing to sell; every later phase (listings, orders,
payouts) hangs off an approved shop.

**Independent Test**: As a signed-in customer, submit an application, view it as PENDING, edit the
description, and confirm a second application is refused.

**Acceptance Scenarios**:

1. **Given** a signed-in customer with no shop, **When** they submit a complete application, **Then** a
   shop is created with status PENDING and a unique web-friendly identifier (slug) derived from its name.
2. **Given** a customer who already has a shop (any status), **When** they apply again, **Then** the
   request is refused with an "already has a shop" conflict.
3. **Given** an application whose district does not belong to the chosen region, **When** submitted,
   **Then** it is rejected with a clear validation message.
4. **Given** an application with no species, an unknown species, or an invalid phone number, **When**
   submitted, **Then** it is rejected.
5. **Given** two shops named "Mwanza Cattle", **When** the second is created, **Then** it receives a
   distinct slug (e.g. `mwanza-cattle-2`).
6. **Given** a REJECTED shop, **When** the owner edits it and resubmits, **Then** its status returns to
   PENDING and the previous rejection reason is cleared.
7. **Given** a SUSPENDED shop, **When** the owner tries to edit it, **Then** the request is refused.
8. **Given** a PENDING or APPROVED shop, **When** the owner resubmits, **Then** the request is refused
   because only rejected shops can be resubmitted.

---

### User Story 2 - Admin reviews and moderates shops (Priority: P1)

A platform administrator sees the queue of shop applications, filters by status, searches by shop name,
opens one to see full details (including the payout account), and approves or rejects it with a reason.
Approving makes the applicant a vendor immediately. Later, an administrator can suspend a misbehaving
shop and reactivate it.

**Why this priority**: Approval is the gate that makes a customer a vendor; without it US1 has no outcome.

**Independent Test**: Seeded admin lists PENDING shops, rejects one with a reason, approves another, and
confirms the approved owner can immediately use vendor-only operations; then suspends and reactivates it.

**Acceptance Scenarios**:

1. **Given** PENDING, APPROVED and REJECTED shops, **When** an admin lists shops filtered by PENDING,
   **Then** only PENDING shops are returned, paginated, newest application first.
2. **Given** a PENDING shop, **When** an admin approves it, **Then** the shop becomes APPROVED, the owner's
   role becomes VENDOR in the same step, and the owner's very next request is treated as a vendor.
3. **Given** a PENDING shop, **When** an admin rejects it without a reason, **Then** the request is
   refused; with a reason, the shop becomes REJECTED and the owner can see the reason.
4. **Given** an APPROVED shop, **When** an admin suspends it, **Then** it becomes SUSPENDED and disappears
   from public browsing; reactivating returns it to APPROVED.
5. **Given** a shop in a state where an action is not allowed (e.g. approving an APPROVED shop, suspending
   a PENDING shop), **When** attempted, **Then** it is refused with a conflict message naming the current
   status.
6. **Given** a signed-in customer or vendor, **When** they call any shop administration operation,
   **Then** access is denied.

---

### User Story 3 - Browse shops publicly (Priority: P2)

Anyone, without signing in, browses the marketplace's shops: filtering by region, district and species,
searching by name, and opening a shop's page by its slug to see its name, description, location,
species, business phone and logo.

**Why this priority**: Buyers need to discover sellers, but this only matters once shops exist and are
approved (US1, US2).

**Independent Test**: With a mix of shops in every status, list shops anonymously and confirm only
approved shops of active owners are returned, with filters working and no private fields exposed.

**Acceptance Scenarios**:

1. **Given** shops in every status, **When** a visitor lists shops, **Then** only APPROVED shops whose
   owner account is active are returned, paginated.
2. **Given** approved shops in Arusha and Dodoma, **When** a visitor filters by Arusha region, **Then**
   only Arusha shops are returned; filtering by district and by species narrows results likewise.
3. **Given** an approved shop, **When** a visitor opens it by slug, **Then** its public details are shown
   and no payout details, rejection reason or reviewer information appear.
4. **Given** a PENDING, REJECTED or SUSPENDED shop, or one whose owner is deactivated, **When** a visitor
   opens it by slug, **Then** it is reported as not found.

---

### User Story 4 - Shop logo and payout account (Priority: P2)

A shop owner uploads a logo so buyers recognise the shop, and records how they want to be paid: either a
mobile-money wallet (M-Pesa, Mixx by Yas, Airtel Money or HaloPesa) or a bank account. Only the owner and
platform administrators can see payout details. No money moves in this phase.

**Why this priority**: Improves trust and prepares for payouts, but shops can be reviewed and browsed
without it.

**Independent Test**: As a shop owner, upload a PNG logo and see its link on the shop, replace and
remove it; set a mobile-money payout account, switch it to a bank account, and confirm an admin sees it
while the public shop page does not.

**Acceptance Scenarios**:

1. **Given** a shop owner, **When** they upload a JPEG, PNG or WebP image up to 2 MB, **Then** it becomes
   the shop logo and the shop shows a link to it; uploading again replaces it.
2. **Given** a file larger than 2 MB, or a file whose content is not a real JPEG/PNG/WebP image (even if
   named `.png`), **When** uploaded, **Then** it is rejected.
3. **Given** a shop with a logo, **When** the owner removes it, **Then** the shop no longer has a logo.
4. **Given** a shop owner, **When** they set a mobile-money payout account with provider, a valid +255
   number and an account name, **Then** it is saved; **When** they later set a bank account (bank name,
   account number, account name), **Then** it replaces the mobile-money details.
5. **Given** a mobile-money payout without a provider, or a bank payout without an account number, or a
   payout mixing mobile-money and bank fields, **When** submitted, **Then** it is rejected.
6. **Given** a user without a shop, **When** they try to upload a logo or set a payout account, **Then**
   they are told they have no shop.

---

### Edge Cases

- Shop name that slugifies to an empty string (e.g. only symbols) → rejected as invalid name.
- Shop name with Swahili or accented characters → slug keeps ASCII letters/digits only, e.g.
  "Ng'ombe Bora" → `ngombe-bora`.
- Two applications created simultaneously with the same name → both succeed with distinct slugs, or one
  is retried; never a server error.
- Owner account deactivated by an admin → shop disappears from public browsing but its status is
  unchanged; reactivating the account brings it back.
- Approving an applicant whose account is deactivated → refused.
- Suspended vendor keeps the VENDOR role (later phases check shop status before allowing selling).
- Logo upload fails partway → the previous logo stays in place.
- Changing the shop name does not change the slug (links stay stable).
- Payout account number for a bank is stored as text (leading zeros preserved).

## Requirements *(mandatory)*

### Functional Requirements

**Application & owner management**

- **FR-001**: A signed-in CUSTOMER with no shop MUST be able to apply for a shop by providing shop name
  (2–80 characters), description (up to 1000 characters), region, district, business phone and at least
  one species.
- **FR-002**: Each user MUST have at most one shop; a second application is refused with a conflict.
- **FR-003**: Species MUST be one of CATTLE, GOAT, SHEEP, PIG, CHICKEN, FISH, without duplicates.
- **FR-004**: The district MUST belong to the chosen region; the business phone MUST be a valid Tanzanian
  mobile number stored in `+255XXXXXXXXX` form.
- **FR-005**: The system MUST generate a unique, lowercase, URL-safe slug from the shop name at creation;
  collisions get a numeric suffix; the slug does not change when the name is edited.
- **FR-006**: A new shop MUST start as PENDING with its submission time recorded.
- **FR-007**: The owner MUST be able to view their own shop (including status and, if rejected, the
  rejection reason) and edit its details while PENDING, REJECTED or APPROVED; edits to SUSPENDED shops
  MUST be refused.
- **FR-008**: The owner MUST be able to resubmit a REJECTED shop, which returns it to PENDING, clears the
  rejection reason and updates the submission time; resubmitting any other status is refused.

**Administration**

- **FR-009**: ADMINs MUST be able to list shops, paginated, filtered by status and searched by shop name,
  newest submission first.
- **FR-010**: ADMINs MUST be able to view any shop's full details including owner summary, payout account,
  rejection reason and who reviewed it and when.
- **FR-011**: ADMINs MUST be able to approve a PENDING shop; approval and changing the owner's role to
  VENDOR MUST happen together (both or neither) and take effect on the owner's next request.
- **FR-012**: ADMINs MUST be able to reject a PENDING shop with a mandatory reason (up to 500 characters).
- **FR-013**: ADMINs MUST be able to suspend an APPROVED shop and reactivate a SUSPENDED shop.
- **FR-014**: Any status change not listed in FR-011 to FR-013 MUST be refused with a conflict message
  that names the current status. Approving an applicant whose account is deactivated MUST be refused.
- **FR-015**: Each review action MUST record the reviewing admin and the time.

**Public browsing**

- **FR-016**: Anyone MUST be able to list shops without signing in; only APPROVED shops whose owner
  account is active are included.
- **FR-017**: The public list MUST be paginated and filterable by region, district, species and a
  case-insensitive name search.
- **FR-018**: Anyone MUST be able to view one visible shop by slug; non-visible shops are reported as not
  found.
- **FR-019**: Public shop views MUST expose only: slug, name, description, region, district, business
  phone, species, logo link, and when the shop joined; never payout details, owner personal data,
  rejection reasons or reviewer information.

**Logo**

- **FR-020**: The owner MUST be able to upload a logo of at most 2 MB whose actual content is JPEG, PNG
  or WebP; anything else is rejected.
- **FR-021**: A new logo MUST replace the previous one, which is then removed from storage; a failed
  upload MUST leave the previous logo intact.
- **FR-022**: The owner MUST be able to remove the logo.
- **FR-023**: Logos MUST be stored in object storage separate from the database and served via a public
  link.

**Payout account**

- **FR-024**: The owner MUST be able to set (create or replace) one payout account of method MOBILE_MONEY
  (provider MPESA, MIXX_BY_YAS, AIRTEL_MONEY or HALOPESA; valid +255 number; account name) or BANK (bank
  name, account number of 6–30 digits, account name).
- **FR-025**: Payout fields MUST match the chosen method — the system MUST refuse missing required fields
  and fields belonging to the other method, both at validation and storage level.
- **FR-026**: Payout details MUST be visible only to the shop owner and ADMINs.

**Cross-cutting**

- **FR-027**: All new operations MUST follow the platform's existing conventions: versioned API, request
  validation rejecting unknown fields, one error shape, interactive documentation, paginated lists, and
  role-based access.

### Key Entities

- **Vendor (Shop)**: A seller's shop owned by exactly one user. Attributes: shop name, slug, description,
  region, district, business phone, species, optional logo, status (PENDING, APPROVED, REJECTED,
  SUSPENDED), rejection reason, submission time, reviewer and review time.
- **Payout Account**: How a shop wants to be paid; at most one per shop. Method (MOBILE_MONEY or BANK),
  provider and mobile number (mobile money), bank name and account number (bank), account name.
- **User** (existing): gains the VENDOR role when their shop is approved.
- **Region / District** (existing): seeded Tanzania locations used for shop location.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A customer can submit a complete shop application in under 3 minutes.
- **SC-002**: An approved applicant can perform vendor-only actions on their very next request, with no
  need to sign in again.
- **SC-003**: 100% of invalid status changes, invalid species, wrong region/district pairs and
  mismatched payout details are refused (verified by automated tests).
- **SC-004**: 0 public responses contain payout details, rejection reasons or reviewer information
  (verified by automated tests).
- **SC-005**: 100% of non-image or oversize logo uploads are refused, including files disguised with an
  image extension.
- **SC-006**: Public shop listing and shop page respond in under 1 second for 95% of requests at 100
  concurrent users.
- **SC-007**: 100% of new operations appear in the interactive documentation.

## Assumptions

- Only users with role CUSTOMER can apply; admins cannot own shops.
- A suspended vendor keeps the VENDOR role; selling restrictions for suspended shops arrive with listings.
- Deactivating a user (Phase 1) hides their shop publicly without changing shop status.
- No notifications are sent on approval/rejection in this phase; owners see the status when they check.
- Logo images are not resized or re-encoded; they are stored as uploaded after content verification.
- Payout details are stored but not verified with providers; no money moves until the payouts phase.
- Shops are not deleted in this phase; suspension is the removal mechanism.
- Object storage is S3-compatible; a local S3-compatible service is used in development.
