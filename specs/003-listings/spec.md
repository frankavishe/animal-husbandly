# Feature Specification: Listings

**Feature Branch**: `003-listings`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Phase 3 — Listings for the Animal Husbandry Marketplace (Tanzania, TZS). (US1, P1) A VENDOR whose shop is APPROVED creates and manages listings: title (3–120), description (≤2000), species, listing type, unit, integer TZS unit price (>0), integer stock quantity (≥0). Species/type rules (constitution II): LIVE_ANIMAL and MEAT for every species; MILK only CATTLE; EGGS only CHICKEN — refused with HTTP 400 and also enforced at DB level. Listing species must be one the shop declared. Vendor picks the unit from an allowed set per type: LIVE_ANIMAL → HEAD or KG; MEAT → KG or PIECE; MILK → LITRE; EGGS → PIECE or TRAY (30). LIVE_ANIMAL listings MUST include breed, sex (MALE, FEMALE, MIXED) and age in months; optional approximate weight in kg; these fields are refused on other types. Vendors see/edit only their own listings. (US2, P1) Lifecycle: created as DRAFT; vendor publishes to ACTIVE, pauses to INACTIVE, re-activates, or archives (soft delete, irreversible, hidden everywhere except admin). Publishing does not require stock>0 (an ACTIVE listing with zero stock is shown as out of stock). Vendors whose shop is SUSPENDED cannot create, edit or publish; invalid transitions return a conflict naming the current status. (US3, P2) Public browsing without sign-in: list ACTIVE listings whose shop is APPROVED and owner active, paginated, filter by species, type, region, district, shop slug, price range, in-stock only; name/text search; sort by newest or price asc/desc; view one listing by id with shop summary (slug, name, region, district); never expose private shop data. (US4, P2) Photos: up to 5 per listing, JPEG/PNG/WebP verified by content, max 5 MB each, stored in the existing S3-compatible object storage; vendor can add, remove and reorder; first is cover; failed upload leaves existing photos intact. (US5, P3) ADMIN lists all listings (any status, filter by status/shop/species/type), views any listing, and takes one down (TAKEN_DOWN with mandatory reason ≤500, recorded admin+time) or restores it to INACTIVE; vendor sees the reason and cannot republish a taken-down listing. Out of scope: cart, orders, stock reservation/decrement, reviews, promotions, discounts, notifications, bulk import."

## Clarifications

### Session 2026-11-23

- Q: Can one LIVE_ANIMAL listing sold by HEAD stand for a group of similar animals (stock above 1)? → A: Yes; breed, sex and age describe the group, sex MIXED is allowed and age is the typical age.
- Q: Can a vendor change a listing's species or listing type after it has been published? → A: No; species and type are editable only while the listing is DRAFT.
- Q: How precise should a live animal's approximate weight be? → A: 0.1 to 2000 kg in 0.1 kg steps, stored exactly (not floating point).
- Q: When a vendor archives a listing, should its photos stay in storage or be deleted? → A: Keep them; visible to admins, never served publicly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and manage my listings (Priority: P1)

An approved vendor — a cattle keeper, a butcher, a dairy farmer or a poultry farmer — puts products up for
sale. For each product they give a title, a description, the species, what kind of product it is (live
animal, meat, milk or eggs), the unit they sell by, the price per unit in Tanzanian Shillings and how many
units they have. A live animal also needs its breed, sex and age. The marketplace refuses products it does
not sell, such as goat milk or cattle eggs. The vendor sees all of their own listings and can correct
them; they can never see or change another vendor's drafts.

**Why this priority**: Listings are the catalogue; without them buyers have nothing to browse and later
phases (cart, orders) have nothing to sell.

**Independent Test**: As an approved vendor, create a cattle live-animal listing and a chicken eggs
listing, try to create goat milk and cattle eggs listings (both refused), list "my listings", edit a
price, and confirm a second vendor cannot see or edit them.

**Acceptance Scenarios**:

1. **Given** a vendor with an APPROVED shop that deals in cattle, **When** they create a LIVE_ANIMAL
   cattle listing with title, description, unit HEAD, price 1,200,000 TZS, stock 3, breed "Boran", sex
   FEMALE and age 30 months, **Then** a DRAFT listing is created and returned to them.
2. **Given** an approved vendor, **When** they create MILK for GOAT, SHEEP or PIG, or EGGS for any species
   other than CHICKEN, **Then** the request is refused with a clear message naming the disallowed
   species/type combination.
3. **Given** an approved vendor, **When** they create MILK for CATTLE, EGGS for CHICKEN, or MEAT and
   LIVE_ANIMAL for each of the six species, **Then** each is accepted.
4. **Given** a shop that declared only GOAT and SHEEP, **When** its vendor creates a CATTLE listing,
   **Then** it is refused because the shop does not deal in that species.
5. **Given** a listing type, **When** the vendor picks a unit outside that type's allowed set (e.g. MILK
   by KG, EGGS by HEAD), **Then** it is refused.
6. **Given** a LIVE_ANIMAL listing without breed, sex or age, **When** submitted, **Then** it is refused;
   **Given** a MEAT, MILK or EGGS listing that includes breed, sex, age or weight, **When** submitted,
   **Then** it is refused.
7. **Given** a price of 0, a negative or fractional price, or a negative or fractional stock, **When**
   submitted, **Then** it is refused.
8. **Given** a vendor whose shop is SUSPENDED, PENDING or REJECTED, or a CUSTOMER, **When** they try to
   create a listing, **Then** the request is refused.
9. **Given** two vendors, **When** vendor B tries to view or edit vendor A's listing through vendor
   operations, **Then** it is reported as not found.
10. **Given** a DRAFT listing, **When** the vendor edits its species or type, **Then** all species, type,
    unit and live-animal rules are re-checked exactly as on creation; **Given** an ACTIVE, INACTIVE or
    TAKEN_DOWN listing, **When** the vendor tries to change its species or type, **Then** it is refused
    (they create a new listing instead).
11. **Given** an approved goat vendor, **When** they create a LIVE_ANIMAL GOAT listing with unit HEAD,
    stock 10, breed "Small East African", sex MIXED and age 8 months, **Then** it is accepted as a group
    listing.

---

### User Story 2 - Publish, pause and archive listings (Priority: P1)

A vendor keeps a listing as a draft while preparing it, publishes it when ready, pauses it when the
animals are temporarily unavailable, re-activates it later, and archives it when it is gone for good.

**Why this priority**: Vendors need control over what buyers see; without publishing, US1 has no public
outcome.

**Independent Test**: As an approved vendor, publish a draft, pause it, re-activate it, archive it, and
confirm each invalid step (e.g. publishing an archived listing) is refused with the current status named.

**Acceptance Scenarios**:

1. **Given** a DRAFT listing, **When** the vendor publishes it, **Then** it becomes ACTIVE.
2. **Given** an ACTIVE listing, **When** the vendor pauses it, **Then** it becomes INACTIVE; **When** they
   activate it again, **Then** it is ACTIVE.
3. **Given** a DRAFT, ACTIVE or INACTIVE listing, **When** the vendor archives it, **Then** it becomes
   ARCHIVED, disappears from the vendor's normal list and from public browsing, and can no longer be
   edited, published or restored by the vendor.
4. **Given** a listing in a status where an action is not allowed (e.g. pausing a DRAFT, publishing an
   ARCHIVED or TAKEN_DOWN listing), **When** attempted, **Then** it is refused with a conflict message
   naming the current status.
5. **Given** an ACTIVE listing with stock 0, **When** browsed, **Then** it is still shown, marked as out of
   stock.
6. **Given** a vendor whose shop has been SUSPENDED, **When** they try to edit or publish a listing,
   **Then** it is refused; pausing or archiving is still allowed.

---

### User Story 3 - Browse listings publicly (Priority: P2)

Anyone, without signing in, browses what is for sale: filtering by species, product type, region,
district, a particular shop, price range and availability; searching by words; sorting by newest or by
price; and opening a listing to see its details, photos and which shop sells it.

**Why this priority**: Buyers need to find products, but this only matters once listings exist and are
published (US1, US2).

**Independent Test**: With listings in every status across shops in every status, browse anonymously and
confirm only ACTIVE listings of approved shops with active owners appear, filters and sorting work, and
no private shop data is exposed.

**Acceptance Scenarios**:

1. **Given** listings in every status, **When** a visitor lists listings, **Then** only ACTIVE listings
   whose shop is APPROVED and whose owner account is active are returned, paginated, newest first by
   default.
2. **Given** visible listings for cattle and chicken in Arusha and Dodoma, **When** a visitor filters by
   species, type, region, district or shop slug, **Then** only matching listings are returned; combined
   filters narrow results together.
3. **Given** visible listings priced 50,000 and 500,000 TZS, **When** a visitor filters by a price range of
   100,000–1,000,000, **Then** only the 500,000 listing is returned; sorting by price ascending or
   descending orders results accordingly.
4. **Given** visible listings with and without stock, **When** the visitor asks for in-stock only,
   **Then** listings with stock 0 are excluded.
5. **Given** a visible listing titled "Boran heifer", **When** a visitor searches "boran", **Then** it is
   returned (case-insensitive match on title and description).
6. **Given** a visible listing, **When** a visitor opens it by its identifier, **Then** they see its
   public details, photos and a shop summary (slug, name, region, district) and no payout details,
   owner personal data or moderation information.
7. **Given** a DRAFT, INACTIVE, ARCHIVED or TAKEN_DOWN listing, or one whose shop is not APPROVED or
   whose owner is deactivated, **When** a visitor opens it, **Then** it is reported as not found.

---

### User Story 4 - Listing photos (Priority: P2)

A vendor adds up to five photos to a listing so buyers can see the animal or product, removes ones they no
longer want, and chooses the order; the first photo is the cover shown in browsing.

**Why this priority**: Photos strongly drive buyer trust, but listings can be created, published and
browsed without them.

**Independent Test**: As a vendor, upload three photos to a listing, reorder them, remove one, try to add
a sixth photo and a disguised non-image file (both refused), and confirm the public listing shows the
photos in the chosen order with the first as cover.

**Acceptance Scenarios**:

1. **Given** a vendor's listing with fewer than five photos, **When** they upload a JPEG, PNG or WebP image
   up to 5 MB, **Then** it is added at the end of the photo list and gets a public link.
2. **Given** a listing with five photos, **When** another is uploaded, **Then** it is refused.
3. **Given** a file larger than 5 MB, or a file whose content is not a real JPEG/PNG/WebP image (even if
   named `.jpg`), **When** uploaded, **Then** it is refused and existing photos are unchanged.
4. **Given** a listing with photos, **When** the vendor submits a new order listing every current photo
   exactly once, **Then** the photos are stored in that order and the first is the cover; an order that
   omits, repeats or includes unknown photos is refused.
5. **Given** a listing with photos, **When** the vendor removes one, **Then** it no longer appears and
   the remaining photos keep their relative order.
6. **Given** another vendor's listing, or an ARCHIVED listing, **When** a vendor tries to manage its
   photos, **Then** the request is refused.

---

### User Story 5 - Admin moderates listings (Priority: P3)

A platform administrator reviews all listings regardless of status, filters them, opens any listing, and
takes down one that breaks marketplace rules with a reason the vendor can see. An administrator can later
restore it so the vendor may publish it again.

**Why this priority**: Moderation protects buyers, but the catalogue works without it at small scale.

**Independent Test**: The seeded admin lists listings filtered by status and shop, takes down an ACTIVE
listing with a reason, confirms it vanishes publicly and the vendor sees the reason and cannot publish
it, then restores it to INACTIVE and the vendor publishes it again.

**Acceptance Scenarios**:

1. **Given** listings in every status, **When** an admin lists them filtered by status, shop, species or
   type, **Then** matching listings of any status (including ARCHIVED) are returned, paginated, newest
   first.
2. **Given** any listing, **When** an admin opens it, **Then** they see full details including status,
   take-down reason, who took it down and when.
3. **Given** a DRAFT, ACTIVE or INACTIVE listing, **When** an admin takes it down without a reason,
   **Then** it is refused; with a reason, it becomes TAKEN_DOWN and the admin and time are recorded.
4. **Given** a TAKEN_DOWN listing, **When** its vendor views it, **Then** they see the reason; **When**
   they try to publish it, **Then** it is refused.
5. **Given** a TAKEN_DOWN listing, **When** an admin restores it, **Then** it becomes INACTIVE, the
   take-down reason is cleared, and the vendor may publish it again.
6. **Given** a signed-in customer or vendor, **When** they call any listing administration operation,
   **Then** access is denied.

---

### Edge Cases

- A vendor removes a species from their shop after creating listings for it → existing listings are
  unaffected; the "shop deals in this species" rule applies only when a listing's species is set or
  changed.
- Shop suspended while listings are ACTIVE → listings disappear from public browsing without changing
  status; reactivating the shop brings them back.
- Owner account deactivated → listings disappear publicly with status unchanged; reactivation restores
  them.
- Editing an ACTIVE listing keeps it ACTIVE; changes are visible immediately.
- Changing a DRAFT listing's type from LIVE_ANIMAL to MEAT must also drop the live-animal details in the
  same request, otherwise it is refused; published listings cannot change type at all.
- EGGS sold by TRAY means a tray of 30 eggs; the unit label makes this explicit to buyers.
- Very large values: price above 1,000,000,000 TZS or stock above 1,000,000 are refused.
- Photo upload fails partway (e.g. storage unavailable) → no partial photo is recorded; existing photos
  remain.
- Removing or reordering photos on an ACTIVE listing is allowed and takes effect immediately.
- An archived listing's photos are kept for administrators but are not served in any public view.
- Concurrent status changes on the same listing → one wins, the other gets a conflict naming the current
  status; never a server error.
- Public price filter where minimum exceeds maximum → refused as invalid.

## Requirements *(mandatory)*

### Functional Requirements

**Listing details**

- **FR-001**: A VENDOR whose shop is APPROVED MUST be able to create a listing with: title (3–120
  characters), description (up to 2000 characters), species, listing type, unit, unit price and stock
  quantity.
- **FR-002**: Species MUST be one of CATTLE, GOAT, SHEEP, PIG, CHICKEN, FISH; listing type MUST be one of
  LIVE_ANIMAL, MEAT, MILK, EGGS.
- **FR-003**: The system MUST allow LIVE_ANIMAL and MEAT for every species, MILK only for CATTLE and EGGS
  only for CHICKEN. Disallowed combinations MUST be refused as invalid input with a message naming the
  combination, and MUST also be impossible to store by any path (enforced by the data store itself).
- **FR-004**: A listing's species MUST be one of the species declared by the vendor's shop at the time the
  species is set or changed.
- **FR-005**: The unit MUST belong to the listing type's allowed set: LIVE_ANIMAL → HEAD or KG; MEAT → KG
  or PIECE; MILK → LITRE; EGGS → PIECE or TRAY (a tray is 30 eggs).
- **FR-006**: Unit price MUST be a whole number of Tanzanian Shillings from 1 to 1,000,000,000; stock
  quantity MUST be a whole number from 0 to 1,000,000.
- **FR-007**: LIVE_ANIMAL listings MUST include breed (2–60 characters), sex (MALE, FEMALE or MIXED) and
  age in whole months (0–600), and MAY include approximate weight in kilograms from 0.1 to 2000 in steps
  of 0.1. A LIVE_ANIMAL listing may describe a group of similar animals (stock above 1); its details then
  describe the group, with sex MIXED for mixed groups and age being the typical age. Listings of any other
  type MUST NOT carry these fields; such requests are refused.
- **FR-008**: The vendor MUST be able to list their own listings (paginated, filterable by status,
  excluding ARCHIVED unless asked), view one, and edit its details; all rules in FR-002 to FR-007 apply to
  edits.
- **FR-009**: Vendors MUST NOT be able to see or modify another vendor's listings through vendor
  operations; such listings are reported as not found.

**Lifecycle**

- **FR-010**: A new listing MUST start as DRAFT.
- **FR-011**: The vendor MUST be able to: publish DRAFT → ACTIVE; pause ACTIVE → INACTIVE; activate
  INACTIVE → ACTIVE; archive DRAFT, ACTIVE, INACTIVE or TAKEN_DOWN → ARCHIVED. Archiving is irreversible.
- **FR-012**: Any status change not listed in FR-011 or FR-020/FR-021 MUST be refused with a conflict
  message naming the current status.
- **FR-013**: Editing MUST be allowed for DRAFT, ACTIVE, INACTIVE and TAKEN_DOWN listings and refused for
  ARCHIVED listings; editing does not change status. Species and listing type MUST be changeable only
  while the listing is DRAFT; attempts to change them in any other status are refused.
- **FR-014**: While the vendor's shop is not APPROVED, the vendor MUST NOT be able to create, edit or
  publish/activate listings or add photos; pausing and archiving remain allowed.
- **FR-015**: Publishing MUST NOT require stock above zero.

**Public browsing**

- **FR-016**: Anyone MUST be able to list listings without signing in; only ACTIVE listings whose shop is
  APPROVED and whose owner account is active are included.
- **FR-017**: The public list MUST be paginated and support filters by species, type, region, district,
  shop slug, minimum and maximum unit price, and in-stock only; a case-insensitive text search over title
  and description; and sorting by newest (default), price ascending or price descending.
- **FR-018**: Anyone MUST be able to view one visible listing by its identifier; non-visible listings are
  reported as not found.
- **FR-019**: Public listing views MUST expose only: identifier, title, description, species, type, unit,
  unit price, stock quantity, an in-stock indicator, live-animal details (if any), photos in order with
  the cover marked, publication time, and a shop summary (slug, name, region, district). They MUST NOT
  expose payout details, owner personal data, take-down information or non-public statuses.

**Moderation**

- **FR-020**: ADMINs MUST be able to list all listings (any status, paginated, newest first, filterable by
  status, shop, species and type), view any listing in full, and take down a DRAFT, ACTIVE or INACTIVE
  listing with a mandatory reason (up to 500 characters), recording the admin and time.
- **FR-021**: ADMINs MUST be able to restore a TAKEN_DOWN listing to INACTIVE, which clears the reason.
- **FR-022**: The vendor MUST see the take-down reason on their own TAKEN_DOWN listing and MUST NOT be
  able to publish or activate it.

**Photos**

- **FR-023**: The vendor MUST be able to add photos to a non-archived listing, at most 5 per listing, each
  at most 5 MB, whose actual content is JPEG, PNG or WebP; anything else is refused.
- **FR-024**: The vendor MUST be able to remove a photo and set the complete photo order; the first photo
  is the cover.
- **FR-025**: A failed upload MUST leave the existing photos unchanged; a removed photo MUST be removed
  from storage. Archiving a listing MUST keep its photos in storage; they are visible to admins and never
  served publicly.
- **FR-026**: Photos MUST be stored in object storage separate from the main data and served via public
  links.

**Cross-cutting**

- **FR-027**: All new operations MUST follow the platform's existing conventions: versioned API, request
  validation rejecting unknown fields, one error shape, interactive documentation, paginated lists and
  role-based access.

### Key Entities

- **Listing**: A product a shop offers. Attributes: shop, title, description, species, listing type,
  unit, unit price (whole TZS), stock quantity, live-animal details (breed, sex, age in months, optional
  weight at 0.1 kg precision; may describe a group of similar animals), status (DRAFT, ACTIVE, INACTIVE, ARCHIVED, TAKEN_DOWN), publication time, take-down reason,
  taking-down admin and time, creation and update times.
- **Listing Photo**: An image of a listing; up to 5 per listing, with a position (first = cover) and a
  public link.
- **Species / Listing Type Rule**: The fixed table of allowed species–type combinations from the
  constitution.
- **Vendor (Shop)** (existing): owns listings; its status and declared species gate listing creation and
  visibility.
- **User** (existing): the vendor owner; deactivation hides their listings publicly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An approved vendor can create and publish a listing with photos in under 3 minutes.
- **SC-002**: 100% of disallowed species/type combinations (milk for goat, sheep, pig, chicken, fish;
  eggs for any species but chicken) are refused, and every allowed combination is accepted (verified by
  automated tests covering all 24 combinations).
- **SC-003**: 100% of invalid units, prices, stock values, missing/extra live-animal details, species or
  type changes after publishing, and invalid status changes are refused (verified by automated tests).
- **SC-004**: 0 public responses contain non-visible listings, payout details, owner personal data or
  take-down information (verified by automated tests).
- **SC-005**: 100% of oversize or non-image photo uploads and sixth-photo uploads are refused, including
  files disguised with an image extension.
- **SC-006**: Public listing search and listing pages respond in under 1 second for 95% of requests at 100
  concurrent users with 10,000 listings.
- **SC-007**: 100% of new operations appear in the interactive documentation.

## Assumptions

- Only VENDORs with an APPROVED shop can create listings; admins cannot own listings.
- Listings are identified publicly by an opaque identifier, not a slug.
- Stock for KG-unit listings is in whole kilograms.
- Stock is informational in this phase; no orders change it until the cart/orders phase.
- Prices are fixed per unit; no negotiation, discounts or promotions in this phase.
- Photos are not resized or re-encoded; they are stored as uploaded after content verification.
- Archived listings are kept (soft delete) for history and future order references; they are never
  permanently deleted in this phase.
- No notifications are sent on take-down or restore; vendors see the status when they check.
- Listing location is the shop's region and district; listings have no separate location.
- The shop owner manages listings alone; there are no shop staff accounts.
