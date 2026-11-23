import { Prisma } from '@prisma/client';
import { StorageService } from '../common/storage';
import {
  ListingWithRelations,
  toAdminListing,
  toOwnerListing,
  toPublicListing,
} from './listing.mapper';

const storage = { publicUrl: (k: string) => `http://s/${k}` } as StorageService;

function listing(overrides: Partial<ListingWithRelations> = {}): ListingWithRelations {
  return {
    id: 'l1',
    vendorId: 'v1',
    title: 'Boran heifer',
    description: 'Healthy',
    species: 'CATTLE',
    listingType: 'LIVE_ANIMAL',
    unit: 'HEAD',
    unitPrice: 1200000,
    stockQuantity: 0,
    breed: 'Boran',
    sex: 'FEMALE',
    ageMonths: 30,
    weightKg: new Prisma.Decimal('350.5'),
    status: 'TAKEN_DOWN',
    publishedAt: new Date('2026-01-01'),
    archivedAt: null,
    takenDownReason: 'Fake photos',
    takenDownById: 'a1',
    takenDownAt: new Date('2026-01-02'),
    createdAt: new Date('2025-12-31'),
    updatedAt: new Date('2026-01-02'),
    photos: [
      { id: 'p0', listingId: 'l1', key: 'listings/l1/a.png', position: 0, createdAt: new Date() },
      { id: 'p1', listingId: 'l1', key: 'listings/l1/b.jpg', position: 1, createdAt: new Date() },
    ],
    vendor: {
      id: 'v1',
      slug: 'shop',
      shopName: 'Shop',
      status: 'APPROVED',
      region: { id: 1, name: 'Arusha' },
      district: { id: 2, name: 'Meru' },
    },
    takenDownBy: { id: 'a1', fullName: 'Admin' },
    ...overrides,
  };
}

describe('listing mapper', () => {
  it('public view exposes exactly the FR-019 fields', () => {
    const pub = toPublicListing(listing(), storage);
    expect(Object.keys(pub).sort()).toEqual(
      [
        'id',
        'title',
        'description',
        'species',
        'listingType',
        'unit',
        'unitPrice',
        'stockQuantity',
        'inStock',
        'animal',
        'photos',
        'coverUrl',
        'publishedAt',
        'shop',
      ].sort(),
    );
    expect(Object.keys(pub.shop).sort()).toEqual(['district', 'region', 'shopName', 'slug']);
    expect(JSON.stringify(pub)).not.toMatch(/TAKEN_DOWN|Fake photos|vendorId|"v1"/);
  });

  it('maps animal details with a numeric weight, cover = position 0, stock flag', () => {
    const pub = toPublicListing(listing(), storage);
    expect(pub.animal).toEqual({ breed: 'Boran', sex: 'FEMALE', ageMonths: 30, weightKg: 350.5 });
    expect(typeof pub.animal!.weightKg).toBe('number');
    expect(pub.coverUrl).toBe('http://s/listings/l1/a.png');
    expect(pub.photos.map((p) => p.position)).toEqual([0, 1]);
    expect(pub.inStock).toBe(false);
    expect(toPublicListing(listing({ stockQuantity: 2 }), storage).inStock).toBe(true);
  });

  it('weight is null when absent; animal is null for non-live listings; cover null without photos', () => {
    expect(toPublicListing(listing({ weightKg: null }), storage).animal!.weightKg).toBeNull();
    const meat = toPublicListing(
      listing({
        listingType: 'MEAT',
        unit: 'KG',
        breed: null,
        sex: null,
        ageMonths: null,
        weightKg: null,
        photos: [],
      }),
      storage,
    );
    expect(meat.animal).toBeNull();
    expect(meat.coverUrl).toBeNull();
  });

  it('owner and admin views add status, moderation and shop refs', () => {
    const owner = toOwnerListing(listing(), storage);
    expect(owner).toMatchObject({ status: 'TAKEN_DOWN', takenDownReason: 'Fake photos' });
    const admin = toAdminListing(listing(), storage);
    expect(admin.vendor).toEqual({ id: 'v1', slug: 'shop', shopName: 'Shop', status: 'APPROVED' });
    expect(admin.takenDownBy).toEqual({ id: 'a1', fullName: 'Admin' });
    expect(toAdminListing(listing({ takenDownBy: null }), storage).takenDownBy).toBeNull();
  });
});
