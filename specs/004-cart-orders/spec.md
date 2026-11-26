# Feature Specification: Cart & Orders

**Feature Branch**: `004-cart-orders`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Phase 4 — Cart & Orders for the Animal Husbandry Marketplace (Tanzania, TZS). (US1, P1) A signed-in user has one cart: add visible listings, change quantity, remove, clear, view grouped by shop with current prices and totals; quantity ≥1 and ≤ stock; adding again increases quantity; nothing is reserved; unavailable, short-of-stock or repriced lines stay, flagged; users cannot buy from their own shop. (US2, P1) Checkout with a saved address and cash on delivery; one order splits into one sub-order per shop; all-or-nothing: re-check every line, take stock, copy address and item details, empty the cart; a changed price needs the customer's confirmation; never oversell; repeated submissions return the same order. (US3, P1) Vendor sees only their shop's sub-orders and moves them PENDING → CONFIRMED → DISPATCHED → DELIVERED, or rejects PENDING with a reason ≤500; delivered means cash collected; a suspended shop can still finish existing orders. (US4, P2) Customer lists and views own orders with overall status and history, and cancels a PENDING sub-order; stock returns exactly once. (US5, P3) ADMIN lists, filters and views all orders and cancels undelivered sub-orders with a mandatory reason. Out of scope: online payments, refunds, commission, ledger, payouts, delivery fees, pickup, courier tracking, reviews, notifications, guest carts, coupons, timed reservations, returns after delivery."

## Clarifications

### Session 2026-11-24

- Q: What does this phase cover? → A: Cart and orders; online payments, commission and payouts are the next phase.
- Q: How are orders paid for in this phase? → A: Cash on delivery only.
- Q: When is stock taken from a listing? → A: At checkout; it returns on cancellation or rejection. Carts reserve nothing.
- Q: How does delivery work in this phase? → A: The customer picks a saved address, which is copied into the order; the vendor delivers, with no fee and no pickup.
- Q: What happens to a sub-order the vendor never confirms or rejects? → A: The marketplace cancels it after 48 hours and its stock returns.
- Q: Who can end an order the vendor confirmed but cannot fulfil? → A: The vendor, before dispatch, with a mandatory reason; after dispatch only an admin.
- Q: Does stock return automatically when a dispatched sub-order is cancelled? → A: No; the vendor restocks when goods come back. All other cancellations and rejections return stock.
- Q: How are price or cart changes detected at checkout? → A: The customer confirms every line (listing, quantity, unit price seen); any difference is refused.
- Q: Is there a limit on a customer's open orders? → A: Yes, at most 10 OPEN orders.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fill my cart (Priority: P1)

A signed-in buyer collects products from one or more shops in a cart: a goat from one keeper, trays of eggs
from another. They change quantities, remove items, and see what each shop's goods cost and the total. The
cart tells them when something has become unavailable, is short of stock or has a new price.

**Why this priority**: Checkout needs a cart; it is the first step of every purchase.

**Independent Test**: As a customer, add listings from two shops, change a quantity, remove one, and confirm
the grouping, subtotals and total; then have a vendor change a price and pause a listing and confirm both
lines are flagged.

**Acceptance Scenarios**:

1. **Given** a visible listing with stock 10, **When** a customer adds 3, **Then** their cart has one line
   of 3 with the current unit price and line total.
2. **Given** a cart with 3 of that listing, **When** they add 2 more, **Then** the same line becomes 5;
   **When** they then add 6 more, **Then** it is refused because only 10 are in stock, and the line stays 5.
3. **Given** a cart line, **When** the customer sets its quantity to 4, **Then** it becomes 4; **When** they
   set 0, a negative or fractional quantity, or more than the stock, **Then** it is refused.
4. **Given** lines from two shops, **When** the customer views the cart, **Then** lines are grouped by shop,
   each with a subtotal, plus an overall total.
5. **Given** a listing that is not publicly visible, **When** a customer adds it, **Then** it is reported as
   not found; **Given** a visible listing with stock 0, **Then** adding it is refused as out of stock.
6. **Given** a vendor, **When** they add a listing of their own shop, **Then** it is refused; **When** they
   add another shop's listing, **Then** it is accepted.
7. **Given** a cart line, **When** its listing stops being visible, its stock falls below the line quantity,
   or its price changes, **Then** the line stays and is flagged unavailable, short of stock (with the
   quantity left) or price changed (with old and new price) respectively.
8. **Given** a cart, **When** the customer removes a line or clears the cart, **Then** those lines are gone
   and no stock has changed.
9. **Given** a visitor who is not signed in, or an administrator, **When** they use a cart, **Then** access
   is denied; no user can see or change another user's cart.

---

### User Story 2 - Place an order (Priority: P1)

The buyer chooses one of their saved addresses, agrees to pay cash on delivery and places the order. Each
shop receives its own part. Either everything is ordered or nothing is, and no shop sells more than it has.

**Why this priority**: Placing an order is the marketplace's core outcome.

**Independent Test**: Check out a two-shop cart and confirm one order with two sub-orders, reduced stock and
an empty cart; repeat the submission and confirm no second order; have two buyers race for the last animal
and confirm only one succeeds.

**Acceptance Scenarios**:

1. **Given** a valid cart with lines from two shops and a saved address, **When** the customer checks out
   confirming every line as they saw it, **Then** one order is created with two PENDING sub-orders, each listing's stock
   falls by the ordered quantity, and the cart is empty.
2. **Given** a cart where any line is unavailable or short of stock, **When** the customer checks out,
   **Then** the whole checkout is refused naming every problem line, and nothing changes.
3. **Given** a price that changed after the customer viewed the cart, **When** they check out with the old
   price, **Then** it is refused naming the line with its old and current price, even if other changes leave
   the total the same; **When** they confirm the current prices, **Then** the order is placed at those prices.
4. **Given** a listing with stock 1 in two customers' carts, **When** both check out at once, **Then** exactly
   one succeeds, the other is told it is out of stock, and stock is 0.
5. **Given** a completed checkout, **When** the same submission key is sent again, including at the same
   moment, **Then** the same order is returned and stock is taken only once; **When** the key is reused with
   a different address or lines, **Then** it is refused as a conflict.
6. **Given** an empty cart, or an address that is missing or belongs to someone else, **When** the customer
   checks out, **Then** it is refused and nothing changes.
7. **Given** a placed order, **When** the vendor later edits, pauses or archives the listing, or the customer
   edits or deletes the address, **Then** the order still shows the details as they were at checkout.
8. **Given** a cart whose total exceeds 10,000,000,000 TZS, **When** the customer checks out, **Then** it is
   refused as above the maximum order total.
9. **Given** a customer with 10 OPEN orders, **When** they check out, **Then** it is refused naming the limit and
   nothing changes; **When** one of those orders is no longer OPEN, **Then** they can check out again.

---

### User Story 3 - Fulfil my shop's orders (Priority: P1)

A vendor sees the orders placed with their shop, confirms or rejects each one, marks it dispatched when it
leaves, and marks it delivered once the goods are handed over and the cash is collected.

**Why this priority**: An order nobody can fulfil has no value.

**Independent Test**: As a vendor, take one sub-order through to DELIVERED, reject another with a reason,
confirm rejected stock returns, and confirm another vendor cannot see either.

**Acceptance Scenarios**:

1. **Given** a PENDING sub-order, **When** its vendor confirms, dispatches and delivers it in turn, **Then**
   it becomes CONFIRMED, DISPATCHED and DELIVERED, each step recorded with who and when; on delivery the cash
   is recorded as collected.
2. **Given** a PENDING sub-order, **When** the vendor rejects it without a reason, or with one above 500
   characters, **Then** it is refused; with a valid reason it becomes REJECTED, the customer can see the
   reason, and its stock returns.
3. **Given** a sub-order in a status where an action is not allowed (e.g. delivering a PENDING one, rejecting
   a CONFIRMED one), **When** attempted, **Then** it is refused with a conflict naming the current status.
4. **Given** an order spanning two shops, **When** one vendor views their sub-order, **Then** they see their
   own items and subtotal, the recipient name, contact phone and delivery address, and nothing about the
   other shop, the order total or the customer's account details.
5. **Given** another shop's sub-order, **When** a vendor views or changes it, **Then** it is reported as not
   found.
6. **Given** a shop suspended after receiving orders, **When** its vendor progresses or rejects them, **Then**
   it is allowed.
7. **Given** sub-orders in several statuses, **When** the vendor lists them by status, **Then** matching ones
   are returned, paginated, newest first.
8. **Given** a CONFIRMED sub-order, **When** the vendor cancels it without a reason, or with one above 500
   characters, **Then** it is refused; with a valid reason it becomes CANCELLED, the customer sees the reason,
   and its stock returns.
9. **Given** a DISPATCHED sub-order, **When** the vendor cancels it, **Then** it is refused with a conflict naming
   the current status.

---

### User Story 4 - Follow and cancel my orders (Priority: P2)

A buyer sees their past and current orders, the progress of each shop's part, and can cancel a part the shop
has not yet confirmed.

**Why this priority**: Buyers need visibility and a way to correct mistakes, but orders can be placed and
fulfilled without it.

**Independent Test**: Place a two-shop order, cancel one part, let the other be delivered, and confirm
statuses, history and returned stock.

**Acceptance Scenarios**:

1. **Given** a customer with orders, **When** they list them, **Then** only their own are returned, paginated,
   newest first, filterable by overall status.
2. **Given** an own order, **When** opened, **Then** it shows items, prices, subtotals, total, delivery
   address, each sub-order's status and status history, and any rejection or cancellation reason.
3. **Given** a PENDING sub-order, **When** the customer cancels it, **Then** it becomes CANCELLED, its stock
   returns, and other sub-orders are unaffected; a reason up to 500 characters is optional.
4. **Given** a sub-order that is not PENDING, **When** the customer cancels it, **Then** it is refused with a
   conflict naming the current status.
5. **Given** an order, **Then** its overall status is OPEN while any sub-order is PENDING, CONFIRMED or
   DISPATCHED; otherwise COMPLETED if at least one was DELIVERED; otherwise CANCELLED.
6. **Given** another customer's order, **When** viewed or cancelled, **Then** it is reported as not found.
7. **Given** a sub-order still PENDING 48 hours after the order was placed, **When** the time limit passes,
   **Then** it becomes CANCELLED by the marketplace with a reason saying the shop did not respond in time, its
   stock returns, and other sub-orders are unaffected.

---

### User Story 5 - Admin oversees orders (Priority: P3)

An administrator looks up any order and cancels a part that cannot be completed, such as when a shop has
disappeared or a buyer is fraudulent.

**Why this priority**: It resolves stuck orders, which are rare at small scale.

**Independent Test**: As admin, filter orders by status and shop, cancel a CONFIRMED sub-order with a reason
and confirm the stock returns; cancel a DISPATCHED one and confirm stock is unchanged; confirm the customer and
vendor see both reasons.

**Acceptance Scenarios**:

1. **Given** many orders, **When** an admin lists them, **Then** results are paginated, newest first, and
   filterable by overall status, sub-order status, shop, customer and placement date range.
2. **Given** any order, **When** an admin opens it, **Then** they see full details including customer, all
   sub-orders and status history.
3. **Given** a PENDING, CONFIRMED or DISPATCHED sub-order, **When** an admin cancels it without a reason,
   **Then** it is refused; with a reason up to 500 characters it becomes CANCELLED, the admin and time are
   recorded, and customer and vendor see the reason; stock returns if it was PENDING or CONFIRMED and does not
   if it was DISPATCHED.
4. **Given** a DELIVERED, REJECTED or CANCELLED sub-order, **When** an admin cancels it, **Then** it is refused
   with a conflict naming the current status.
5. **Given** a customer or vendor, **When** they use any order administration operation, **Then** access is
   denied.

---

### Edge Cases

- Shop suspended, listing paused, archived or taken down, or owner deactivated between cart and checkout →
  the line is unavailable and checkout is refused; if it becomes visible again, the line is usable again.
- Shop owner deactivated with open sub-orders → the customer may cancel PENDING ones, an admin may cancel
  any undelivered one, and unanswered PENDING ones expire as usual.
- Customer deactivated with open orders → orders stay and the vendor can still progress, reject or cancel them;
  an admin may cancel them; unanswered PENDING ones expire as usual.
- Customer cancels while the vendor confirms or rejects → exactly one succeeds, the other gets a conflict
  naming the current status; stock returns at most once.
- Two requests cancel the same sub-order at once → one succeeds and stock returns once.
- Stock returning to an ARCHIVED, INACTIVE or TAKEN_DOWN listing → the quantity is added back and the listing
  keeps its status. If it would exceed 1,000,000, stock is set to 1,000,000.
- A vendor edits a listing without changing its stock while a checkout takes stock → the checkout's reduction
  is preserved. A vendor who explicitly sets stock declares the quantity now remaining, and that value stands.
- Cart changed on another device before checkout → the confirmed lines no longer match and checkout is refused.
- The 48-hour limit passes while the vendor confirms or the customer cancels → exactly one change succeeds; stock
  returns at most once.
- The system is unavailable when a sub-order reaches 48 hours → it expires within 15 minutes of service returning.
- A shop is suspended while its sub-orders are PENDING → the 48-hour limit still applies.
- A customer with 9 OPEN orders submits two checkouts at once with different keys → at most one succeeds.
- Repeating a successful submission key while at the open-order limit → the original order is still returned.
- A failed checkout does not use up its submission key; the customer can correct the problem and retry.
- The cart holds 50 different listings → adding another is refused; carts do not expire.
- Two simultaneous adds of the same listing → one line with the combined quantity, never above stock.
- An order with every sub-order rejected → overall status CANCELLED.

## Requirements *(mandatory)*

### Functional Requirements

**Cart**

- **FR-001**: Each signed-in CUSTOMER or VENDOR MUST have exactly one private cart. Visitors and ADMINs MUST
  NOT be able to use a cart or check out.
- **FR-002**: Users MUST be able to add a publicly visible listing (ACTIVE, shop APPROVED, owner active), set a
  line's quantity, remove a line and clear the cart. A non-visible listing is reported as not found.
- **FR-003**: Line quantity MUST be a whole number of at least 1 and at most the listing's current stock when
  set. Adding a listing already in the cart MUST increase its line. A cart MUST hold at most 50 lines.
- **FR-004**: Users MUST NOT be able to buy listings of their own shop.
- **FR-005**: Cart operations MUST NOT change or reserve stock.
- **FR-006**: The cart view MUST group lines by shop with current unit prices, line totals, shop subtotals and
  an overall total. Unavailable lines MUST be excluded from totals.
- **FR-007**: Lines whose listing is unavailable, short of stock, or priced differently from when the line was
  last added to or changed MUST be kept and flagged. Flags MUST NOT reveal moderation details.

**Checkout**

- **FR-008**: Users MUST be able to check out their whole cart by giving one of their own saved addresses, every
  line as they saw it (listing, quantity and unit price) and a submission key. Cash on delivery is the only payment method.
- **FR-009**: Checkout MUST be all-or-nothing: either the order is created, all stock is taken and the cart is
  emptied, or nothing changes.
- **FR-010**: Checkout MUST re-check every line for visibility, stock and own-shop purchase, and a refusal MUST
  name every problem line.
- **FR-010a**: Checkout MUST be refused, naming the limit, while the customer has 10 OPEN orders (FR-023). The
  limit MUST hold under simultaneous checkouts and MUST NOT block repeating a successful submission (FR-013).
- **FR-011**: Checkout MUST be refused when the confirmed lines differ from the cart or current prices (any
  missing, extra or different line), naming each differing line with its current values. Orders are always
  placed at the confirmed prices.
- **FR-012**: Stock MUST never fall below zero or be sold twice, however many checkouts happen at once.
- **FR-013**: Repeating a successful submission key by the same user MUST return the original order without
  further effect; reusing it with a different address or lines MUST be refused as a conflict. Keys of
  different users are independent.
- **FR-014**: An order MUST be split into one sub-order per shop, each starting PENDING. Every order MUST have a
  unique human-readable order number.
- **FR-015**: An order MUST keep its own copy of the delivery address (recipient name, contact phone, region,
  district, ward/street, landmark) and, per item, the title, species, listing type, unit, unit price,
  quantity and line total, plus the shop name.
- **FR-016**: All amounts MUST be exact whole TZS, with line totals, subtotals and order total consistent. An
  order total MUST NOT exceed 10,000,000,000 TZS.

**Fulfilment**

- **FR-017**: Shop owners MUST be able to list (paginated, newest first, filterable by status) and view only
  their own shop's sub-orders; others are reported as not found.
- **FR-018**: The vendor MUST be able to confirm PENDING → CONFIRMED, dispatch CONFIRMED → DISPATCHED, deliver
  DISPATCHED → DELIVERED, reject PENDING → REJECTED and cancel CONFIRMED → CANCELLED. Rejecting and cancelling
  require a reason (1–500 characters).
- **FR-019**: Marking DELIVERED MUST record that the sub-order's cash was collected and when.
- **FR-020**: Vendors MUST see only their own items and subtotal, the order number, placement time, recipient
  name, contact phone, delivery address, and their sub-order's status, history and reasons.
- **FR-021**: FR-017 to FR-020 MUST remain available to a vendor whose shop is SUSPENDED.

**Customer orders**

- **FR-022**: Customers MUST be able to list (paginated, newest first, filterable by overall status) and view
  only their own orders; others are reported as not found.
- **FR-023**: Overall status MUST be OPEN while any sub-order is PENDING, CONFIRMED or DISPATCHED; otherwise
  COMPLETED if any is DELIVERED; otherwise CANCELLED.
- **FR-024**: Customers MUST be able to cancel a PENDING sub-order, PENDING → CANCELLED, with an optional reason
  of up to 500 characters.
- **FR-024a**: A sub-order still PENDING 48 hours after placement MUST become CANCELLED by the marketplace, with a
  standard reason, within a further 15 minutes (or within 15 minutes of service returning after an outage). Until
  then the usual PENDING actions remain allowed.
- **FR-025**: Customer views MUST NOT expose payout details, other vendor-owner personal data or admin
  identities; cancellations by an administrator and automatic cancellations are shown as made by the
  marketplace.

**Administration**

- **FR-026**: ADMINs MUST be able to list all orders (paginated, newest first, filterable by overall status,
  sub-order status, shop, customer and placement date range) and view any order in full.
- **FR-027**: ADMINs MUST be able to cancel a PENDING, CONFIRMED or DISPATCHED sub-order with a mandatory reason
  (1–500 characters), recording the admin and time.

**Integrity**

- **FR-028**: Any status change not listed in FR-018, FR-024, FR-024a or FR-027 MUST be refused with a conflict
  naming the current status. Of simultaneous changes, exactly one MUST succeed.
- **FR-029**: Cancelling or rejecting a PENDING or CONFIRMED sub-order MUST return each item's quantity to its
  listing exactly once, together with the status change, without changing the listing's status and up to the
  1,000,000 stock limit. Cancelling a DISPATCHED sub-order MUST NOT change stock.
- **FR-030**: Every status change MUST be recorded with previous status, new status, actor (a user or the marketplace itself), time and any reason,
  and these records MUST NOT be edited or removed.
- **FR-031**: Orders MUST NOT be deleted or altered as a result of changing, archiving or removing a listing,
  shop, address or user account.
- **FR-032**: Editing a listing without supplying a stock quantity MUST NOT change its stock, even while
  checkouts are taking place.
- **FR-033**: All new operations MUST follow the platform's existing conventions: versioned API, request
  validation rejecting unknown fields, one error shape, interactive documentation, paginated lists and
  role-based access.

### Key Entities

- **Cart**: A user's single collection of intended purchases; has up to 50 lines.
- **Cart Line**: A listing, a quantity and the unit price last seen by the user.
- **Order**: One checkout by a customer: order number, delivery address copy, payment method, total, placement
  time, submission key, derived overall status.
- **Sub-order**: One shop's part of an order: shop, shop name copy, items, subtotal, status (PENDING, CONFIRMED,
  DISPATCHED, DELIVERED, REJECTED, CANCELLED), cash collection time.
- **Order Item**: A copy of what was bought, with a reference to its listing for returning stock.
- **Status History Entry**: A permanent record of one sub-order status change.
- **Listing, Shop, Address, User** (existing): sources of what is bought, who sells, where it goes and who buys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A customer with a saved address can go from viewing a listing to a placed order in under 2 minutes.
- **SC-002**: With 50 simultaneous checkouts for a listing with stock 10, quantity 1 each, exactly 10 succeed,
  stock ends at 0 and the rest are told it is out of stock.
- **SC-003**: 100% of failed checkouts (including those over the open-order limit or with differing lines) leave
  stock, cart and orders unchanged, and 100% of repeated submissions produce one order (verified by automated
  tests).
- **SC-004**: 100% of invalid status changes are refused, and stock returns exactly once for every cancellation,
  expiry or rejection of a PENDING or CONFIRMED sub-order and never for a DISPATCHED one, including simultaneous
  attempts (verified by automated tests).
- **SC-005**: 0 responses expose another user's cart or order, another shop's sub-order, or data excluded by
  FR-020 and FR-025 (verified by automated tests).
- **SC-006**: For 100% of orders, the total equals the sum of its sub-orders and of its items, and is unaffected
  by later listing, shop or address changes.
- **SC-007**: 95% of cart views, checkouts and order pages complete in under 1 second with 100 concurrent users
  and 10,000 orders.
- **SC-008**: 100% of new operations appear in the interactive documentation.

## Assumptions

- Vendors keep buying rights as customers of other shops; administrators cannot buy.
- The whole cart is checked out at once; selecting individual lines is not supported.
- Quantities are whole units, including KG and LITRE, as in the listings phase.
- Vendors deliver to any address in Tanzania and arrange delivery by phone; a vendor unable to deliver rejects.
- The delivered confirmation is made by the vendor alone; customers do not confirm receipt in this phase.
- A vendor unable to complete a DISPATCHED sub-order asks an administrator to cancel it, and raises the listing's
  stock themselves if the goods come back in sellable condition.
- The 48-hour response limit and the limit of 10 open orders are fixed and the same for everyone in this phase.
- No minimum order amount. The 10,000,000,000 TZS maximum is a safety limit.
- Cash collected is recorded only as a fact on the sub-order; commission and balances come with payments.
- Out of scope: online payments, payment statuses and refunds, commission, ledger, payouts, delivery fees,
  pickup, courier tracking, reviews, notifications, guest carts, coupons, timed reservations and returns
  after delivery.
- Depends on existing accounts and addresses (Phase 1), shops (Phase 2) and listings (Phase 3).
