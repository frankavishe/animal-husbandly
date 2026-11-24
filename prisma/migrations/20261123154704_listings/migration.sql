-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('LIVE_ANIMAL', 'MEAT', 'MILK', 'EGGS');

-- CreateEnum
CREATE TYPE "ListingUnit" AS ENUM ('HEAD', 'KG', 'PIECE', 'LITRE', 'TRAY');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED', 'TAKEN_DOWN');

-- CreateEnum
CREATE TYPE "AnimalSex" AS ENUM ('MALE', 'FEMALE', 'MIXED');

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "species" "Species" NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "unit" "ListingUnit" NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "stock_quantity" INTEGER NOT NULL,
    "breed" TEXT,
    "sex" "AnimalSex",
    "age_months" INTEGER,
    "weight_kg" DECIMAL(5,1),
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "taken_down_reason" TEXT,
    "taken_down_by_id" UUID,
    "taken_down_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_photos" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_status_published_at_idx" ON "listings"("status", "published_at");

-- CreateIndex
CREATE INDEX "listings_vendor_id_status_idx" ON "listings"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "listings_species_idx" ON "listings"("species");

-- CreateIndex
CREATE INDEX "listings_listing_type_idx" ON "listings"("listing_type");

-- CreateIndex
CREATE INDEX "listings_unit_price_idx" ON "listings"("unit_price");

-- CreateIndex
CREATE INDEX "listing_photos_listing_id_position_idx" ON "listing_photos"("listing_id", "position");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_taken_down_by_id_fkey" FOREIGN KEY ("taken_down_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constitution II / FR-003: milk only from cattle, eggs only from chickens.
ALTER TABLE "listings" ADD CONSTRAINT "listings_species_type" CHECK (
  "listing_type" IN ('LIVE_ANIMAL', 'MEAT')
  OR ("listing_type" = 'MILK' AND "species" = 'CATTLE')
  OR ("listing_type" = 'EGGS' AND "species" = 'CHICKEN')
);

-- FR-005: allowed units per listing type.
ALTER TABLE "listings" ADD CONSTRAINT "listings_unit_type" CHECK (
  ("listing_type" = 'LIVE_ANIMAL' AND "unit" IN ('HEAD', 'KG'))
  OR ("listing_type" = 'MEAT' AND "unit" IN ('KG', 'PIECE'))
  OR ("listing_type" = 'MILK' AND "unit" = 'LITRE')
  OR ("listing_type" = 'EGGS' AND "unit" IN ('PIECE', 'TRAY'))
);

-- FR-007: animal details only (and required, except weight) for live animals.
ALTER TABLE "listings" ADD CONSTRAINT "listings_animal_fields" CHECK (
  ("listing_type" = 'LIVE_ANIMAL'
     AND "breed" IS NOT NULL AND "sex" IS NOT NULL AND "age_months" IS NOT NULL)
  OR ("listing_type" <> 'LIVE_ANIMAL'
     AND "breed" IS NULL AND "sex" IS NULL AND "age_months" IS NULL AND "weight_kg" IS NULL)
);

-- FR-006/007: numeric ranges.
ALTER TABLE "listings" ADD CONSTRAINT "listings_ranges" CHECK (
  "unit_price" BETWEEN 1 AND 1000000000
  AND "stock_quantity" BETWEEN 0 AND 1000000
  AND ("age_months" IS NULL OR "age_months" BETWEEN 0 AND 600)
  AND ("weight_kg" IS NULL OR "weight_kg" BETWEEN 0.1 AND 2000)
);

-- FR-023: at most 5 photos, position 0 = cover.
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_position" CHECK ("position" BETWEEN 0 AND 4);
