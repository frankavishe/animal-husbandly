-- CreateEnum
CREATE TYPE "SubOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "OrderActorType" AS ENUM ('CUSTOMER', 'VENDOR', 'ADMIN', 'MARKETPLACE');

-- DropIndex
DROP INDEX "vendors_species_gin";

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "last_seen_price" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "region_name" TEXT NOT NULL,
    "district_name" TEXT NOT NULL,
    "ward_street" TEXT NOT NULL,
    "landmark" TEXT,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    "total" BIGINT NOT NULL,
    "submission_key" UUID NOT NULL,
    "submission_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_orders" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "shop_name" TEXT NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "status" "SubOrderStatus" NOT NULL DEFAULT 'PENDING',
    "cash_collected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sub_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "sub_order_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "species" "Species" NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "unit" "ListingUnit" NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_order_status_history" (
    "id" UUID NOT NULL,
    "sub_order_id" UUID NOT NULL,
    "from_status" "SubOrderStatus",
    "to_status" "SubOrderStatus" NOT NULL,
    "actor_type" "OrderActorType" NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- CreateIndex
CREATE INDEX "cart_items_listing_id_idx" ON "cart_items"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_listing_id_key" ON "cart_items"("cart_id", "listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_seq_key" ON "orders"("seq");

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_customer_id_submission_key_key" ON "orders"("customer_id", "submission_key");

-- CreateIndex
CREATE INDEX "sub_orders_vendor_id_status_idx" ON "sub_orders"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "sub_orders_status_created_at_idx" ON "sub_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sub_orders_order_id_vendor_id_key" ON "sub_orders"("order_id", "vendor_id");

-- CreateIndex
CREATE INDEX "order_items_listing_id_idx" ON "order_items"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_sub_order_id_listing_id_key" ON "order_items"("sub_order_id", "listing_id");

-- CreateIndex
CREATE INDEX "sub_order_status_history_sub_order_id_created_at_idx" ON "sub_order_status_history"("sub_order_id", "created_at");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_order_status_history" ADD CONSTRAINT "sub_order_status_history_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_order_status_history" ADD CONSTRAINT "sub_order_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ CHECK constraints (raw SQL)

-- FR-003: cart quantities and the last price the buyer saw.
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity" CHECK (
  "quantity" BETWEEN 1 AND 1000000
  AND "last_seen_price" BETWEEN 1 AND 1000000000
);

-- FR-016: order and sub-order amounts.
ALTER TABLE "orders" ADD CONSTRAINT "orders_total" CHECK ("total" BETWEEN 1 AND 10000000000);
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_subtotal" CHECK ("subtotal" BETWEEN 1 AND 10000000000);

-- FR-019: cash is recorded as collected exactly when the sub-order is DELIVERED.
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_cash_collected" CHECK (
  ("status" = 'DELIVERED') = ("cash_collected_at" IS NOT NULL)
);

-- FR-016: item copies and their line totals.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_total" CHECK (
  "unit_price" BETWEEN 1 AND 1000000000
  AND "quantity" BETWEEN 1 AND 1000000
  AND "line_total" = "unit_price"::bigint * "quantity"
);

-- FR-030: automatic actions have no actor user; reasons are at most 500 characters.
ALTER TABLE "sub_order_status_history" ADD CONSTRAINT "sub_order_history_actor" CHECK (
  ("actor_type" = 'MARKETPLACE') = ("actor_id" IS NULL)
  AND ("reason" IS NULL OR char_length("reason") <= 500)
);
