import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, VendorStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyVendorDto, UpdateVendorDto } from './dto';
import { NO_SHOP, SHOP_SUSPENDED, VendorsService } from './vendors.service';

const U = 'user-1';
const customer = { id: U, role: Role.CUSTOMER, sessionId: 's1' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const dto: ApplyVendorDto = {
  shopName: 'Mwanza Cattle',
  description: 'Zebu',
  regionId: 2,
  districtId: 10,
  businessPhone: '+255754123456',
  species: ['CATTLE'],
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    userId: U,
    shopName: dto.shopName,
    slug: 'mwanza-cattle',
    description: 'Zebu',
    regionId: 2,
    districtId: 10,
    businessPhone: dto.businessPhone,
    species: ['CATTLE'],
    logoKey: null as string | null,
    status: VendorStatus.PENDING as VendorStatus,
    rejectionReason: null as string | null,
    submittedAt: new Date(),
    reviewedById: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    region: { id: 2, name: 'Mwanza' },
    district: { id: 10, name: 'Ilemela' },
    payoutAccount: null,
    user: { id: U, fullName: 'Juma', phone: null, email: null, isActive: true },
    reviewedBy: null,
    ...overrides,
  };
}

const p2002 = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

async function errorsOf(cls: new () => object, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true });
  return errors.map((e) => e.property);
}

describe('VendorsService', () => {
  let prisma: any;
  let regions: any;
  let storage: any;
  let service: VendorsService;

  beforeEach(() => {
    prisma = {
      vendor: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }) => Promise.resolve(row(data))),
        update: jest.fn(({ data }) => Promise.resolve(row(data))),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    regions = { assertDistrictInRegion: jest.fn() };
    storage = {
      put: jest.fn(),
      delete: jest.fn(),
      publicUrl: jest.fn((k: string) => `http://cdn/${k}`),
    };
    service = new VendorsService(prisma, regions, storage);
  });

  describe('apply', () => {
    it('creates a PENDING shop with a slug from the name', async () => {
      const res = await service.apply(customer, dto);
      expect(regions.assertDistrictInRegion).toHaveBeenCalledWith(2, 10);
      expect(prisma.vendor.create.mock.calls[0][0].data).toMatchObject({
        userId: U,
        slug: 'mwanza-cattle',
        species: ['CATTLE'],
      });
      expect(res.status).toBe('PENDING');
      expect(res.slug).toBe('mwanza-cattle');
    });

    it('refuses non-customers', async () => {
      await expect(service.apply({ ...customer, role: Role.ADMIN }, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.apply({ ...customer, role: Role.VENDOR }, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a second shop', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v1' });
      await expect(service.apply(customer, dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('suffixes a taken slug with the next number', async () => {
      prisma.vendor.findMany.mockResolvedValue([
        { slug: 'mwanza-cattle' },
        { slug: 'mwanza-cattle-3' },
        { slug: 'mwanza-cattle-goats' },
      ]);
      await service.apply(customer, dto);
      expect(prisma.vendor.create.mock.calls[0][0].data.slug).toBe('mwanza-cattle-4');
    });

    it('uses -2 when only the base slug is taken', async () => {
      prisma.vendor.findMany.mockResolvedValue([{ slug: 'mwanza-cattle' }]);
      await service.apply(customer, dto);
      expect(prisma.vendor.create.mock.calls[0][0].data.slug).toBe('mwanza-cattle-2');
    });

    it('retries once when a concurrent application takes the slug', async () => {
      prisma.vendor.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ slug: 'mwanza-cattle' }]);
      prisma.vendor.create.mockRejectedValueOnce(p2002(['slug']));
      await service.apply(customer, dto);
      expect(prisma.vendor.create).toHaveBeenCalledTimes(2);
      expect(prisma.vendor.create.mock.calls[1][0].data.slug).toBe('mwanza-cattle-2');
    });

    it('maps a concurrent duplicate owner to 409', async () => {
      prisma.vendor.create.mockRejectedValueOnce(p2002(['user_id']));
      await expect(service.apply(customer, dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a name with no letters or digits', async () => {
      await expect(service.apply(customer, { ...dto, shopName: '!!!' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('propagates a region/district mismatch', async () => {
      regions.assertDistrictInRegion.mockRejectedValue(new BadRequestException('mismatch'));
      await expect(service.apply(customer, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.vendor.create).not.toHaveBeenCalled();
    });
  });

  describe('species validation (Constitution II)', () => {
    const plain = { ...dto, businessPhone: '0754123456' };

    it.each([[['CATTLE']], [['GOAT', 'SHEEP', 'PIG', 'CHICKEN', 'FISH']]])(
      'accepts %j',
      async (species) => {
        expect(await errorsOf(ApplyVendorDto, { ...plain, species })).toEqual([]);
      },
    );

    it.each([[[]], [['MILK']], [['cattle']], [['CATTLE', 'CATTLE']], ['CATTLE']])(
      'rejects %j',
      async (species) => {
        expect(await errorsOf(ApplyVendorDto, { ...plain, species })).toContain('species');
      },
    );

    it('rejects an empty species list on update', async () => {
      expect(await errorsOf(UpdateVendorDto, { species: [] })).toContain('species');
      expect(await errorsOf(UpdateVendorDto, { description: 'x' })).toEqual([]);
    });
  });

  describe('getMine / updateMine / resubmit', () => {
    it('404s without a shop', async () => {
      await expect(service.getMine(U)).rejects.toThrow(new NotFoundException(NO_SHOP));
    });

    it('updates fields but never the slug', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ status: VendorStatus.APPROVED }));
      await service.updateMine(U, { shopName: 'New Name', description: 'More' });
      const data = prisma.vendor.update.mock.calls[0][0].data;
      expect(data).toEqual({ shopName: 'New Name', description: 'More' });
      expect(data.slug).toBeUndefined();
    });

    it('re-checks region/district merging stored values', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row());
      await service.updateMine(U, { districtId: 11 });
      expect(regions.assertDistrictInRegion).toHaveBeenCalledWith(2, 11);
    });

    it('refuses edits to a suspended shop', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ status: VendorStatus.SUSPENDED }));
      await expect(service.updateMine(U, { description: 'x' })).rejects.toThrow(
        new ForbiddenException(SHOP_SUSPENDED),
      );
    });

    it('resubmits a REJECTED shop', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ status: VendorStatus.REJECTED }));
      await service.resubmit(U);
      expect(prisma.vendor.updateMany).toHaveBeenCalledWith({
        where: { id: 'v1', status: VendorStatus.REJECTED },
        data: expect.objectContaining({ status: 'PENDING', rejectionReason: null }),
      });
    });

    it('refuses to resubmit a PENDING shop', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row());
      prisma.vendor.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.resubmit(U)).rejects.toThrow('Cannot resubmit a shop that is PENDING');
    });
  });

  describe('public browsing', () => {
    it('only shows approved shops of active owners, with filters', () => {
      expect(
        VendorsService.publicWhere({
          page: 1,
          limit: 20,
          regionId: 2,
          districtId: 10,
          species: 'GOAT',
          search: 'mwa',
        }),
      ).toEqual({
        status: 'APPROVED',
        user: { isActive: true },
        regionId: 2,
        districtId: 10,
        species: { has: 'GOAT' },
        shopName: { contains: 'mwa', mode: 'insensitive' },
      });
    });

    it('404s a hidden slug', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);
      await expect(service.getPublicBySlug('x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vendor.findFirst.mock.calls[0][0].where).toMatchObject({
        status: 'APPROVED',
        user: { isActive: true },
        slug: 'x',
      });
    });

    it('lists with pagination', async () => {
      prisma.vendor.findMany.mockResolvedValue([row({ status: 'APPROVED' })]);
      prisma.vendor.count.mockResolvedValue(21);
      const res = await service.listPublic({ page: 2, limit: 20 });
      expect(res).toMatchObject({ page: 2, total: 21, totalPages: 2 });
      expect(res.items[0]).not.toHaveProperty('status');
    });
  });

  describe('logo', () => {
    it('requires a file', async () => {
      await expect(service.setLogo(U, undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-images without uploading', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row());
      const file = { buffer: Buffer.from('not an image'), size: 12 };
      await expect(service.setLogo(U, file)).rejects.toThrow(
        'Logo must be a JPEG, PNG or WebP image',
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('uploads, points the shop at the new key, then deletes the old one', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ logoKey: 'vendors/v1/old.png' }));
      const res = await service.setLogo(U, { buffer: PNG, size: PNG.length });
      const key = storage.put.mock.calls[0][0] as string;
      expect(key).toMatch(/^vendors\/v1\/logo-[0-9a-f-]{36}\.png$/);
      expect(storage.put).toHaveBeenCalledWith(key, PNG, 'image/png');
      expect(prisma.vendor.update.mock.calls[0][0].data).toEqual({ logoKey: key });
      expect(storage.delete).toHaveBeenCalledWith('vendors/v1/old.png');
      expect(res.logoUrl).toBe(`http://cdn/${key}`);
    });

    it('keeps the old logo when the upload fails', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ logoKey: 'vendors/v1/old.png' }));
      storage.put.mockRejectedValue(new Error('S3 down'));
      await expect(service.setLogo(U, { buffer: PNG, size: PNG.length })).rejects.toThrow(
        'S3 down',
      );
      expect(prisma.vendor.update).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('swallows a failed delete of the old logo', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ logoKey: 'vendors/v1/old.png' }));
      storage.delete.mockRejectedValue(new Error('gone'));
      await expect(service.setLogo(U, { buffer: PNG, size: PNG.length })).resolves.toBeDefined();
    });

    it('refuses logo changes on a suspended shop', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ status: VendorStatus.SUSPENDED }));
      await expect(service.removeLogo(U)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('removes the logo', async () => {
      prisma.vendor.findUnique.mockResolvedValue(row({ logoKey: 'vendors/v1/old.png' }));
      const res = await service.removeLogo(U);
      expect(prisma.vendor.update.mock.calls[0][0].data).toEqual({ logoKey: null });
      expect(storage.delete).toHaveBeenCalledWith('vendors/v1/old.png');
      expect(res.logoUrl).toBeNull();
    });
  });
});
