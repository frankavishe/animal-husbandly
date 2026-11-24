import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma, VendorStatus } from '@prisma/client';
import { CreateListingDto } from './dto';
import { ListingsService } from './listings.service';

const U = 'user-1';
const V = 'vendor-1';
const L = 'listing-1';

function vendor(overrides: Record<string, unknown> = {}) {
  return {
    id: V,
    status: VendorStatus.APPROVED as VendorStatus,
    species: ['CATTLE', 'CHICKEN', 'GOAT'],
    ...overrides,
  };
}

const createDto: CreateListingDto = {
  title: 'Boran heifer',
  species: 'CATTLE',
  listingType: 'LIVE_ANIMAL',
  unit: 'HEAD',
  unitPrice: 1200000,
  stockQuantity: 3,
  breed: 'Boran',
  sex: 'FEMALE',
  ageMonths: 30,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: L,
    vendorId: V,
    title: 'Boran heifer',
    description: '',
    species: 'CATTLE',
    listingType: 'LIVE_ANIMAL',
    unit: 'HEAD',
    unitPrice: 1200000,
    stockQuantity: 3,
    breed: 'Boran' as string | null,
    sex: 'FEMALE' as string | null,
    ageMonths: 30 as number | null,
    weightKg: new Prisma.Decimal(350.5) as Prisma.Decimal | null,
    status: ListingStatus.DRAFT as ListingStatus,
    publishedAt: null as Date | null,
    archivedAt: null,
    takenDownReason: null,
    takenDownById: null,
    takenDownAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    photos: [],
    vendor: {
      id: V,
      slug: 'shop',
      shopName: 'Shop',
      status: VendorStatus.APPROVED,
      region: { id: 1, name: 'Arusha' },
      district: { id: 2, name: 'Meru' },
    },
    takenDownBy: null,
    ...overrides,
  };
}

describe('ListingsService', () => {
  let prisma: any;
  let vendors: any;
  let storage: any;
  let service: ListingsService;
  let current: ReturnType<typeof row> | null;

  beforeEach(() => {
    current = row();
    prisma = {
      listing: {
        create: jest.fn(({ data }) => Promise.resolve(row(data))),
        update: jest.fn(({ data }) => Promise.resolve(row({ ...current, ...data }))),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(() => Promise.resolve(current)),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    vendors = { findMine: jest.fn().mockResolvedValue(vendor()) };
    storage = { publicUrl: (k: string) => `http://s/${k}` };
    service = new ListingsService(prisma, vendors, storage);
  });

  // ------------------------------------------------------------------ US1
  describe('create', () => {
    it('creates a DRAFT listing for an approved shop', async () => {
      const res = await service.create(U, createDto);
      expect(prisma.listing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vendorId: V,
            description: '',
            breed: 'Boran',
            weightKg: null,
          }),
        }),
      );
      expect(res.status).toBe('DRAFT');
      expect(res.animal).toMatchObject({ breed: 'Boran', sex: 'FEMALE', ageMonths: 30 });
    });

    it.each([
      [VendorStatus.PENDING, 'Your shop is not approved'],
      [VendorStatus.REJECTED, 'Your shop is not approved'],
      [VendorStatus.SUSPENDED, 'Your shop is suspended'],
    ])('refuses a %s shop with 403', async (status, message) => {
      vendors.findMine.mockResolvedValue(vendor({ status }));
      await expect(service.create(U, createDto)).rejects.toThrow(ForbiddenException);
      await expect(service.create(U, createDto)).rejects.toThrow(message);
      expect(prisma.listing.create).not.toHaveBeenCalled();
    });

    it('refuses a species the shop does not deal in', async () => {
      await expect(service.create(U, { ...createDto, species: 'PIG' })).rejects.toThrow(
        new BadRequestException('Your shop does not deal in PIG'),
      );
    });

    it('refuses GOAT + MILK with the rule message', async () => {
      const dto: CreateListingDto = {
        title: 'Goat milk',
        species: 'GOAT',
        listingType: 'MILK',
        unit: 'LITRE',
        unitPrice: 2000,
        stockQuantity: 10,
      };
      await expect(service.create(U, dto)).rejects.toThrow(
        new BadRequestException('MILK listings are only allowed for CATTLE'),
      );
      expect(prisma.listing.create).not.toHaveBeenCalled();
    });
  });

  describe('getMine / listMine', () => {
    it('returns 404 for a listing of another shop', async () => {
      current = null;
      await expect(service.getMine(U, 'foreign')).rejects.toThrow(
        new NotFoundException('Listing not found'),
      );
      expect(prisma.listing.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'foreign', vendorId: V } }),
      );
    });

    it('excludes ARCHIVED unless asked', async () => {
      await service.listMine(U, { page: 1, limit: 20 });
      expect(prisma.listing.findMany.mock.calls[0][0].where).toEqual({
        vendorId: V,
        status: { not: 'ARCHIVED' },
      });
      await service.listMine(U, { page: 1, limit: 20, status: 'ARCHIVED' });
      expect(prisma.listing.findMany.mock.calls[1][0].where).toEqual({
        vendorId: V,
        status: 'ARCHIVED',
      });
    });
  });

  describe('updateMine', () => {
    it('updates price and keeps other fields', async () => {
      const res = await service.updateMine(U, L, { unitPrice: 1500000 });
      expect(res.unitPrice).toBe(1500000);
      const data = prisma.listing.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ unitPrice: 1500000, breed: 'Boran', weightKg: 350.5 });
      expect(data.title).toBeUndefined();
    });

    it.each([ListingStatus.ACTIVE, ListingStatus.INACTIVE, ListingStatus.TAKEN_DOWN])(
      'refuses a species change on a %s listing with 409',
      async (status) => {
        current = row({ status });
        await expect(service.updateMine(U, L, { species: 'GOAT' })).rejects.toThrow(
          new ConflictException(
            `Species and listing type can only be changed while the listing is DRAFT (current: ${status})`,
          ),
        );
      },
    );

    it('allows sending the unchanged species on an ACTIVE listing', async () => {
      current = row({ status: ListingStatus.ACTIVE });
      await expect(
        service.updateMine(U, L, { species: 'CATTLE', title: 'X y z' }),
      ).resolves.toBeDefined();
    });

    it('re-validates a species change on a DRAFT', async () => {
      current = row({
        listingType: 'MILK',
        unit: 'LITRE',
        breed: null,
        sex: null,
        ageMonths: null,
        weightKg: null,
      });
      await expect(service.updateMine(U, L, { species: 'CHICKEN' })).rejects.toThrow(
        new BadRequestException('MILK listings are only allowed for CATTLE'),
      );
      await expect(service.updateMine(U, L, { species: 'PIG' })).rejects.toThrow(
        'Your shop does not deal in PIG',
      );
    });

    it('null clears animal fields when switching a DRAFT to MEAT', async () => {
      const res = await service.updateMine(U, L, {
        listingType: 'MEAT',
        unit: 'KG',
        breed: null,
        sex: null,
        ageMonths: null,
        weightKg: null,
      });
      expect(prisma.listing.update.mock.calls[0][0].data).toMatchObject({
        listingType: 'MEAT',
        unit: 'KG',
        breed: null,
        sex: null,
        ageMonths: null,
        weightKg: null,
      });
      expect(res.animal).toBeNull();
    });

    it('refuses switching to MEAT while animal fields remain', async () => {
      await expect(service.updateMine(U, L, { listingType: 'MEAT', unit: 'KG' })).rejects.toThrow(
        'breed is only allowed for LIVE_ANIMAL listings',
      );
    });

    it('refuses editing an ARCHIVED listing with 409', async () => {
      current = row({ status: ListingStatus.ARCHIVED });
      await expect(service.updateMine(U, L, { title: 'New title' })).rejects.toThrow(
        new ConflictException('Cannot edit a listing that is ARCHIVED'),
      );
    });

    it('refuses editing while the shop is suspended', async () => {
      vendors.findMine.mockResolvedValue(vendor({ status: VendorStatus.SUSPENDED }));
      await expect(service.updateMine(U, L, { title: 'New title' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ------------------------------------------------------------------ US2
  describe('lifecycle', () => {
    it.each([
      ['publish', [ListingStatus.DRAFT], ListingStatus.ACTIVE],
      ['pause', [ListingStatus.ACTIVE], ListingStatus.INACTIVE],
      ['activate', [ListingStatus.INACTIVE], ListingStatus.ACTIVE],
      [
        'archive',
        [
          ListingStatus.DRAFT,
          ListingStatus.ACTIVE,
          ListingStatus.INACTIVE,
          ListingStatus.TAKEN_DOWN,
        ],
        ListingStatus.ARCHIVED,
      ],
    ] as const)('%s moves %j → %s with a conditional update', async (action, from, to) => {
      await service[action](U, L);
      const call = prisma.listing.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: L, vendorId: V, status: { in: from } });
      expect(call.data.status).toBe(to);
    });

    it('publish sets publishedAt; activate only fills it in when missing', async () => {
      await service.publish(U, L);
      expect(prisma.listing.updateMany.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
      await service.activate(U, L);
      expect(prisma.listing.updateMany.mock.calls[1][0].data).not.toHaveProperty('publishedAt');
      expect(prisma.listing.updateMany).toHaveBeenCalledTimes(3);
      expect(prisma.listing.updateMany.mock.calls[2][0]).toEqual({
        where: { id: L, vendorId: V, status: ListingStatus.ACTIVE, publishedAt: null },
        data: { publishedAt: expect.any(Date) },
      });
    });

    it('archive sets archivedAt', async () => {
      await service.archive(U, L);
      expect(prisma.listing.updateMany.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
    });

    const invalid: Array<[string, ListingStatus]> = [
      ['publish', ListingStatus.ACTIVE],
      ['publish', ListingStatus.INACTIVE],
      ['publish', ListingStatus.ARCHIVED],
      ['publish', ListingStatus.TAKEN_DOWN],
      ['pause', ListingStatus.DRAFT],
      ['pause', ListingStatus.INACTIVE],
      ['pause', ListingStatus.ARCHIVED],
      ['pause', ListingStatus.TAKEN_DOWN],
      ['activate', ListingStatus.DRAFT],
      ['activate', ListingStatus.ACTIVE],
      ['activate', ListingStatus.ARCHIVED],
      ['activate', ListingStatus.TAKEN_DOWN],
      ['archive', ListingStatus.ARCHIVED],
    ];
    it.each(invalid)('%s on %s → 409 naming the status', async (action, status) => {
      prisma.listing.updateMany.mockResolvedValue({ count: 0 });
      current = row({ status });
      await expect((service as any)[action](U, L) as Promise<unknown>).rejects.toThrow(
        new ConflictException(`Cannot ${action} a listing that is ${status}`),
      );
    });

    it('unknown listing → 404', async () => {
      prisma.listing.updateMany.mockResolvedValue({ count: 0 });
      current = null;
      await expect(service.pause(U, L)).rejects.toThrow(NotFoundException);
    });

    it('suspended shop: publish/activate 403, pause/archive allowed', async () => {
      vendors.findMine.mockResolvedValue(vendor({ status: VendorStatus.SUSPENDED }));
      await expect(service.publish(U, L)).rejects.toThrow(ForbiddenException);
      await expect(service.activate(U, L)).rejects.toThrow(ForbiddenException);
      await expect(service.pause(U, L)).resolves.toBeDefined();
      await expect(service.archive(U, L)).resolves.toBeDefined();
    });
  });

  // ------------------------------------------------------------------ US3
  describe('public', () => {
    it('base filter is ACTIVE listings of visible shops', () => {
      expect(ListingsService.publicWhere({})).toEqual({
        status: 'ACTIVE',
        vendor: { status: 'APPROVED', user: { isActive: true } },
      });
    });

    it('composes every filter', () => {
      expect(
        ListingsService.publicWhere({
          species: 'CATTLE',
          listingType: 'LIVE_ANIMAL',
          regionId: 1,
          districtId: 2,
          shop: 'my-shop',
          minPrice: 100,
          maxPrice: 900,
          inStock: true,
          search: 'boran',
        }),
      ).toEqual({
        status: 'ACTIVE',
        vendor: {
          status: 'APPROVED',
          user: { isActive: true },
          regionId: 1,
          districtId: 2,
          slug: 'my-shop',
        },
        species: 'CATTLE',
        listingType: 'LIVE_ANIMAL',
        unitPrice: { gte: 100, lte: 900 },
        stockQuantity: { gt: 0 },
        OR: [
          { title: { contains: 'boran', mode: 'insensitive' } },
          { description: { contains: 'boran', mode: 'insensitive' } },
        ],
      });
    });

    it('inStock=false and a single price bound', () => {
      const where = ListingsService.publicWhere({ inStock: false, minPrice: 0 });
      expect(where.stockQuantity).toBeUndefined();
      expect(where.unitPrice).toEqual({ gte: 0 });
    });

    it('orders by sort with id as tie-breaker', () => {
      expect(ListingsService.publicOrderBy('newest')).toEqual([
        { publishedAt: 'desc' },
        { id: 'asc' },
      ]);
      expect(ListingsService.publicOrderBy('price_asc')).toEqual([
        { unitPrice: 'asc' },
        { id: 'asc' },
      ]);
      expect(ListingsService.publicOrderBy('price_desc')).toEqual([
        { unitPrice: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('minPrice > maxPrice → 400', async () => {
      await expect(
        service.listPublic({ page: 1, limit: 20, sort: 'newest', minPrice: 5, maxPrice: 1 }),
      ).rejects.toThrow(new BadRequestException('minPrice must not exceed maxPrice'));
    });

    it('getPublic hides non-visible listings', async () => {
      current = null;
      await expect(service.getPublic(L)).rejects.toThrow(NotFoundException);
      expect(prisma.listing.findFirst.mock.calls[0][0].where).toEqual({
        id: L,
        status: 'ACTIVE',
        vendor: { status: 'APPROVED', user: { isActive: true } },
      });
    });
  });
});
