-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Species" AS ENUM ('CATTLE', 'GOAT', 'SHEEP', 'PIG', 'CHICKEN', 'FISH');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('MOBILE_MONEY', 'BANK');

-- CreateEnum
CREATE TYPE "MobileMoneyProvider" AS ENUM ('MPESA', 'MIXX_BY_YAS', 'AIRTEL_MONEY', 'HALOPESA');

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "shop_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "region_id" INTEGER NOT NULL,
    "district_id" INTEGER NOT NULL,
    "business_phone" TEXT NOT NULL,
    "species" "Species"[],
    "logo_key" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payout_accounts" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "provider" "MobileMoneyProvider",
    "mobile_number" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vendor_payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_slug_key" ON "vendors"("slug");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE INDEX "vendors_region_id_idx" ON "vendors"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payout_accounts_vendor_id_key" ON "vendor_payout_accounts"("vendor_id");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payout_accounts" ADD CONSTRAINT "vendor_payout_accounts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw SQL (plan.md Complexity Tracking) ------------------------------------------------------

-- FR-001: every shop deals in at least one species.
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_species_not_empty" CHECK (cardinality("species") >= 1);

-- FR-025: payout fields must match the method.
ALTER TABLE "vendor_payout_accounts" ADD CONSTRAINT "payout_method_fields" CHECK (
  ("method" = 'MOBILE_MONEY' AND "provider" IS NOT NULL AND "mobile_number" IS NOT NULL
     AND "bank_name" IS NULL AND "account_number" IS NULL)
  OR ("method" = 'BANK' AND "bank_name" IS NOT NULL AND "account_number" IS NOT NULL
     AND "provider" IS NULL AND "mobile_number" IS NULL)
);

-- SC-006: efficient `species @> ARRAY[...]` filtering for public browsing.
CREATE INDEX "vendors_species_gin" ON "vendors" USING GIN ("species");