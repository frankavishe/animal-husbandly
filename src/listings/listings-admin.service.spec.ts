import { ConflictException, NotFoundException } from '@nestjs/common';
import { ListingStatus, Prisma, VendorStatus } from '@prisma/client';
import { ListingsAdminService } from './listings-admin.service';

const ADMIN = 'admin-1';
const L = 'listing-1';
const TAKEN_AT = new Date('2026-01-02');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: L,
    vendorId: 'vendor-1',
    title: 'Boran heifer',
    description: '',
    species: 'CATTLE',
    listingType: 'LIVE_ANIMAL',
    unit: 'HEAD',
    unitPrice: 1200000,
    stockQuantity: 3,
    breed: 'Boran',
    sex: 'FEMALE',
    ageMonths: 30,
    weightKg: new Prisma.Decimal(350.5),
    status: ListingStatus.ACTIVE as ListingStatus,
    publishedAt: new Date(),
    archivedAt: null,
    takenDownReason: null as string | null,
    takenDownById: null as string | null,
    takenDownAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    photos: [],
    vendor: {
      id: 'vendor-1',
      slug: 'shop',
      shopName: 'Shop',
      status: VendorStatus.APPROVED,
      region: { id: 1, name: 'Arusha' },
      district: { id: 2, name: 'Meru' },
    },
    takenDownBy: null as { id: string; fullName: string } | null,
    ...overrides,
  };
}

describe('ListingsAdminService', () => {
  let prisma: any;
  let service: ListingsAdminService;
  let current: ReturnType<typeof row> | null;

  beforeEach(() => {
    current = row();
    prisma = {
      listing: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        // Behaves like the real conditional update.
        updateMany: jest.fn(({ where, data }) => {
          if (!current || !where.status.in.includes(current.status)) {
            return Promise.resolve({ count: 0 });
          }
          current = { ...current, ...data };
          return Promise.resolve({ count: 1 });
        }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new ListingsAdminService(prisma, { publicUrl: (k: string) => k } as any);
  });

  it.each([ListingStatus.DRAFT, ListingStatus.ACTIVE, ListingStatus.INACTIVE])(
    'takes down a %s listing recording reason, admin and time',
    async (status) => {
      current = row({ status });
      const res = await service.takeDown(ADMIN, L, 'Misleading photos');
      expect(res.status).toBe(ListingStatus.TAKEN_DOWN);
      expect(prisma.listing.updateMany).toHaveBeenCalledWith({
        where: {
          id: L,
          status: { in: [ListingStatus.DRAFT, ListingStatus.ACTIVE, ListingStatus.INACTIVE] },
        },
        data: {
          status: ListingStatus.TAKEN_DOWN,
          takenDownReason: 'Misleading photos',
          takenDownById: ADMIN,
          takenDownAt: expect.any(Date),
        },
      });
    },
  );

  it.each([ListingStatus.ARCHIVED, ListingStatus.TAKEN_DOWN])(
    'take-down of %s → 409 naming the status',
    async (status) => {
      current = row({ status });
      await expect(service.takeDown(ADMIN, L, 'x')).rejects.toThrow(
        new ConflictException(`Cannot take down a listing that is ${status}`),
      );
      expect(current.status).toBe(status);
    },
  );

  it('restore → INACTIVE, clears the reason and keeps who/when', async () => {
    current = row({
      status: ListingStatus.TAKEN_DOWN,
      takenDownReason: 'Misleading photos',
      takenDownById: ADMIN,
      takenDownAt: TAKEN_AT,
      takenDownBy: { id: ADMIN, fullName: 'Admin' },
    });
    await expect(service.restore(L)).resolves.toMatchObject({
      status: ListingStatus.INACTIVE,
      takenDownReason: null,
      takenDownAt: TAKEN_AT,
      takenDownBy: { id: ADMIN, fullName: 'Admin' },
    });
    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: { id: L, status: { in: [ListingStatus.TAKEN_DOWN] } },
      data: { status: ListingStatus.INACTIVE, takenDownReason: null },
    });
  });

  it.each([
    ListingStatus.DRAFT,
    ListingStatus.ACTIVE,
    ListingStatus.INACTIVE,
    ListingStatus.ARCHIVED,
  ])('restore of %s → 409 naming the status', async (status) => {
    current = row({ status });
    await expect(service.restore(L)).rejects.toThrow(
      new ConflictException(`Cannot restore a listing that is ${status}`),
    );
  });

  it('unknown id → 404 for every operation', async () => {
    current = null;
    await expect(service.get(L)).rejects.toThrow(new NotFoundException('Listing not found'));
    await expect(service.takeDown(ADMIN, L, 'x')).rejects.toThrow(NotFoundException);
    await expect(service.restore(L)).rejects.toThrow(NotFoundException);
  });

  it('get returns shop and take-down details', async () => {
    await expect(service.get(L)).resolves.toMatchObject({
      vendor: { id: 'vendor-1', slug: 'shop', shopName: 'Shop', status: VendorStatus.APPROVED },
      takenDownBy: null,
    });
  });

  it('composes list filters; no filter means every status', () => {
    expect(ListingsAdminService.listWhere({})).toEqual({});
    const all = {
      status: ListingStatus.ARCHIVED,
      vendorId: 'vendor-1',
      species: 'CATTLE',
      listingType: 'MEAT',
    } as const;
    expect(ListingsAdminService.listWhere(all)).toEqual(all);
  });

  it('lists newest first, paginated', async () => {
    prisma.listing.findMany.mockResolvedValue([row()]);
    prisma.listing.count.mockResolvedValue(11);
    const res = await service.list({ page: 2, limit: 10 });
    expect(res).toMatchObject({ page: 2, limit: 10, total: 11, totalPages: 2 });
    expect(prisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 10,
        take: 10,
      }),
    );
  });
});
