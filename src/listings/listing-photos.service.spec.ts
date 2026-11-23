import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, VendorStatus } from '@prisma/client';
import { ListingPhotosService } from './listing-photos.service';

const U = 'user-1';
const V = 'vendor-1';
const L = 'listing-1';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 1),
]);
const file = (buffer: Buffer) => ({ buffer, size: buffer.length });

function photos(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    listingId: L,
    key: `listings/${L}/p${i}.png`,
    position: i,
    createdAt: new Date(),
  }));
}

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
    breed: 'Boran',
    sex: 'FEMALE',
    ageMonths: 30,
    weightKg: null,
    status: ListingStatus.ACTIVE as ListingStatus,
    publishedAt: new Date(),
    archivedAt: null,
    takenDownReason: null,
    takenDownById: null,
    takenDownAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    photos: photos(3),
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

describe('ListingPhotosService', () => {
  let prisma: any;
  let tx: any;
  let vendors: any;
  let storage: any;
  let service: ListingPhotosService;
  let current: ReturnType<typeof row> | null;

  beforeEach(() => {
    current = row();
    tx = {
      listing: { update: jest.fn().mockResolvedValue({}) },
      listingPhoto: {
        count: jest.fn(() => Promise.resolve(current!.photos.length)),
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(current!.photos.find((p) => p.id === where.id) ?? null),
        ),
        delete: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn(() => Promise.resolve(current!.photos.map((p) => ({ id: p.id })))),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      listing: {
        findFirst: jest.fn(() => Promise.resolve(current)),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(current)),
      },
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    vendors = { findMine: jest.fn().mockResolvedValue({ id: V, status: VendorStatus.APPROVED }) };
    storage = {
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      publicUrl: (k: string) => `http://s/${k}`,
    };
    service = new ListingPhotosService(prisma, vendors, storage);
  });

  // ------------------------------------------------------------------ add
  describe('add', () => {
    it('stores the object, locks the listing and appends at position = count', async () => {
      const res = await service.add(U, L, file(PNG));
      expect(storage.put).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^listings/${L}/[0-9a-f-]{36}\\.png$`)),
        PNG,
        'image/png',
      );
      const key = storage.put.mock.calls[0][0];
      expect(tx.listing.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: L } }));
      expect(tx.listingPhoto.create).toHaveBeenCalledWith({
        data: { listingId: L, key, position: 3 },
      });
      expect(storage.delete).not.toHaveBeenCalled();
      expect(res.coverUrl).toBe(`http://s/listings/${L}/p0.png`);
    });

    it('requires a file', async () => {
      await expect(service.add(U, L, undefined)).rejects.toThrow(
        new BadRequestException('A photo file is required'),
      );
      await expect(service.add(U, L, file(Buffer.alloc(0)))).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a non-image without uploading it', async () => {
      await expect(service.add(U, L, file(Buffer.from('not an image')))).rejects.toThrow(
        new BadRequestException('Photo must be a JPEG, PNG or WebP image'),
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a sixth photo before uploading', async () => {
      current = row({ photos: photos(5) });
      await expect(service.add(U, L, file(PNG))).rejects.toThrow(
        new ConflictException('A listing can have at most 5 photos'),
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('deletes the uploaded object when the limit is hit inside the transaction', async () => {
      tx.listingPhoto.count.mockResolvedValue(5);
      await expect(service.add(U, L, file(PNG))).rejects.toThrow(ConflictException);
      const key = storage.put.mock.calls[0][0];
      expect(storage.delete).toHaveBeenCalledWith(key);
      expect(tx.listingPhoto.create).not.toHaveBeenCalled();
    });

    it('deletes the uploaded object and rethrows when the insert fails', async () => {
      const boom = new Error('db down');
      tx.listingPhoto.create.mockRejectedValue(boom);
      await expect(service.add(U, L, file(PNG))).rejects.toBe(boom);
      expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
    });

    it('still rethrows the original error when the cleanup delete fails', async () => {
      const boom = new Error('db down');
      tx.listingPhoto.create.mockRejectedValue(boom);
      storage.delete.mockRejectedValue(new Error('s3 down'));
      await expect(service.add(U, L, file(PNG))).rejects.toBe(boom);
    });
  });

  // ------------------------------------------------------------------ remove
  describe('remove', () => {
    it('deletes the row, compacts later positions, then deletes the object', async () => {
      await service.remove(U, L, 'p1');
      expect(tx.listing.update).toHaveBeenCalled();
      expect(tx.listingPhoto.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(tx.listingPhoto.updateMany).toHaveBeenCalledWith({
        where: { listingId: L, position: { gt: 1 } },
        data: { position: { decrement: 1 } },
      });
      expect(storage.delete).toHaveBeenCalledWith(`listings/${L}/p1.png`);
    });

    it('swallows a storage delete failure', async () => {
      storage.delete.mockRejectedValue(new Error('s3 down'));
      await expect(service.remove(U, L, 'p1')).resolves.toMatchObject({ id: L });
    });

    it('returns 404 for a photo that is not on this listing', async () => {
      await expect(service.remove(U, L, 'other')).rejects.toThrow(
        new NotFoundException('Photo not found'),
      );
      expect(tx.listingPhoto.delete).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ reorder
  describe('reorder', () => {
    it('sets position = index for every photo', async () => {
      await service.reorder(U, L, ['p2', 'p0', 'p1']);
      expect(tx.listing.update).toHaveBeenCalled();
      expect(tx.listingPhoto.update.mock.calls.map((c: any[]) => c[0])).toEqual([
        { where: { id: 'p2' }, data: { position: 0 } },
        { where: { id: 'p0' }, data: { position: 1 } },
        { where: { id: 'p1' }, data: { position: 2 } },
      ]);
    });

    it.each([
      ['a missing id', ['p0', 'p1']],
      ['a duplicate id', ['p0', 'p1', 'p1']],
      ['a foreign id', ['p0', 'p1', 'x9']],
      ['an extra id', ['p0', 'p1', 'p2', 'x9']],
    ])('refuses %s', async (_label, ids) => {
      await expect(service.reorder(U, L, ids)).rejects.toThrow(
        new BadRequestException('photoIds must list every photo of the listing exactly once'),
      );
      expect(tx.listingPhoto.update).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ gates
  describe('gates', () => {
    const ops: [string, (s: ListingPhotosService) => Promise<unknown>][] = [
      ['add', (s) => s.add(U, L, file(PNG))],
      ['remove', (s) => s.remove(U, L, 'p0')],
      ['reorder', (s) => s.reorder(U, L, ['p0', 'p1', 'p2'])],
    ];

    it.each(ops)('%s: suspended shop → 403', async (_name, op) => {
      vendors.findMine.mockResolvedValue({ id: V, status: VendorStatus.SUSPENDED });
      await expect(op(service)).rejects.toThrow(new ForbiddenException('Your shop is suspended'));
      expect(storage.put).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each(ops)('%s: pending shop → 403', async (_name, op) => {
      vendors.findMine.mockResolvedValue({ id: V, status: VendorStatus.PENDING });
      await expect(op(service)).rejects.toThrow(
        new ForbiddenException('Your shop is not approved'),
      );
    });

    it.each(ops)('%s: unknown or foreign listing → 404', async (_name, op) => {
      current = null;
      await expect(op(service)).rejects.toThrow(new NotFoundException('Listing not found'));
      expect(prisma.listing.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: L, vendorId: V } }),
      );
    });

    it.each(ops)('%s: ARCHIVED listing → 409', async (_name, op) => {
      current = row({ status: ListingStatus.ARCHIVED });
      await expect(op(service)).rejects.toThrow(
        new ConflictException('Cannot change photos of a listing that is ARCHIVED'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
