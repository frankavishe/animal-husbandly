import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddressesService } from './addresses.service';

const U = 'user-1';
const base = {
  label: 'Home',
  recipientName: 'Juma',
  contactPhone: '+255712345678',
  regionId: 2,
  districtId: 10,
  wardStreet: 'Kariakoo',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    userId: U,
    ...base,
    landmark: null,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    region: { id: 2, name: 'Dar es Salaam' },
    district: { id: 10, name: 'Ilala' },
    ...overrides,
  };
}

describe('AddressesService', () => {
  let prisma: any;
  let regions: any;
  let service: AddressesService;

  beforeEach(() => {
    prisma = {
      address: {
        count: jest.fn(),
        create: jest.fn(({ data }) => Promise.resolve(row(data))),
        updateMany: jest.fn(),
        update: jest.fn(({ data }) => Promise.resolve(row(data))),
        delete: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    regions = { assertDistrictInRegion: jest.fn() };
    service = new AddressesService(prisma, regions);
  });

  it('first address is default even when not requested', async () => {
    prisma.address.count.mockResolvedValue(0);
    const res = await service.create(U, base);
    expect(res.isDefault).toBe(true);
    expect(prisma.address.updateMany).toHaveBeenCalled();
  });

  it('later address is not default unless requested', async () => {
    prisma.address.count.mockResolvedValue(1);
    const res = await service.create(U, base);
    expect(res.isDefault).toBe(false);
    expect(prisma.address.updateMany).not.toHaveBeenCalled();
  });

  it('a new default unsets the previous default in the same transaction', async () => {
    prisma.address.count.mockResolvedValue(2);
    await service.create(U, { ...base, isDefault: true });
    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { userId: U, isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates region/district mismatch', async () => {
    regions.assertDistrictInRegion.mockRejectedValue(new BadRequestException('nope'));
    await expect(service.create(U, base)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.address.create).not.toHaveBeenCalled();
  });

  it("another user's address is not found", async () => {
    prisma.address.findFirst.mockResolvedValue(null);
    await expect(service.get(U, 'a1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.address.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', userId: U } }),
    );
  });

  it('update checks district against the merged region', async () => {
    prisma.address.findFirst.mockResolvedValue(row());
    await service.update(U, 'a1', { districtId: 11 });
    expect(regions.assertDistrictInRegion).toHaveBeenCalledWith(2, 11);
  });

  it('cannot un-set the current default', async () => {
    prisma.address.findFirst.mockResolvedValue(row({ isDefault: true }));
    await expect(service.update(U, 'a1', { isDefault: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deleting the default promotes the newest remaining address', async () => {
    prisma.address.findFirst
      .mockResolvedValueOnce(row({ isDefault: true }))
      .mockResolvedValueOnce({ id: 'a3' });
    await service.remove(U, 'a1');
    expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(prisma.address.findFirst).toHaveBeenLastCalledWith({
      where: { userId: U },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: 'a3' },
      data: { isDefault: true },
    });
  });

  it('deleting a non-default address promotes nothing', async () => {
    prisma.address.findFirst.mockResolvedValueOnce(row({ isDefault: false }));
    await service.remove(U, 'a1');
    expect(prisma.address.update).not.toHaveBeenCalled();
  });
});
