import { ListingType, Prisma } from '@prisma/client';
import { StorageService } from '../common/storage';
import {
  AdminListingDto,
  OwnerListingDto,
  PhotoDto,
  PublicListingDto,
} from './dto/listing-response.dto';

/** Everything any listing view needs, loaded in one query. */
export const listingInclude = {
  photos: { orderBy: { position: 'asc' } },
  vendor: {
    select: {
      id: true,
      slug: true,
      shopName: true,
      status: true,
      region: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
    },
  },
  takenDownBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ListingInclude;

export type ListingWithRelations = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;

/** Explicit whitelist (FR-019): new columns never leak publicly by accident. */
export function toPublicListing(
  l: ListingWithRelations,
  storage: StorageService,
): PublicListingDto {
  const photos: PhotoDto[] = l.photos.map((p) => ({
    id: p.id,
    url: storage.publicUrl(p.key),
    position: p.position,
  }));
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    species: l.species,
    listingType: l.listingType,
    unit: l.unit,
    unitPrice: l.unitPrice,
    stockQuantity: l.stockQuantity,
    inStock: l.stockQuantity > 0,
    animal:
      l.listingType === ListingType.LIVE_ANIMAL
        ? {
            breed: l.breed!,
            sex: l.sex!,
            ageMonths: l.ageMonths!,
            weightKg: l.weightKg == null ? null : Number(l.weightKg),
          }
        : null,
    photos,
    coverUrl: photos[0]?.url ?? null,
    publishedAt: l.publishedAt,
    shop: {
      slug: l.vendor.slug,
      shopName: l.vendor.shopName,
      region: { id: l.vendor.region.id, name: l.vendor.region.name },
      district: { id: l.vendor.district.id, name: l.vendor.district.name },
    },
  };
}

export function toOwnerListing(l: ListingWithRelations, storage: StorageService): OwnerListingDto {
  return {
    ...toPublicListing(l, storage),
    status: l.status,
    takenDownReason: l.takenDownReason,
    takenDownAt: l.takenDownAt,
    archivedAt: l.archivedAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

export function toAdminListing(l: ListingWithRelations, storage: StorageService): AdminListingDto {
  return {
    ...toOwnerListing(l, storage),
    vendor: {
      id: l.vendor.id,
      slug: l.vendor.slug,
      shopName: l.vendor.shopName,
      status: l.vendor.status,
    },
    takenDownBy: l.takenDownBy ? { id: l.takenDownBy.id, fullName: l.takenDownBy.fullName } : null,
  };
}
