import { ConflictException, NotFoundException } from '@nestjs/common';
import { VendorStatus } from '@prisma/client';
import { ADMIN_TRANSITIONS, AdminAction, VendorsAdminService } from './vendors-admin.service';

const ADMIN = 'admin-1';
const ALL_STATUSES = Object.values(VendorStatus);
const ACTIONS = Object.keys(ADMIN_TRANSITIONS) as AdminAction[];

function fullRow(status: VendorStatus) {
  return {
    id: 'v1',
    userId: 'u1',
    shopName: 'Shop',
    slug: 'shop',
    description: '',
    regionId: 1,
    districtId: 1,
    businessPhone: '+255754123456',
    species: ['CATTLE'],
    logoKey: null,
    status,
    rejectionReason: null,
    submittedAt: new Date(),
    reviewedById: ADMIN,
    reviewedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    region: { id: 1, name: 'Arusha' },
    district: { id: 1, name: 'Arusha City' },
    payoutAccount: null,
    user: { id: 'u1', fullName: 'Juma', phone: null, email: null, isActive: true },
    reviewedBy: { id: ADMIN, fullName: 'Admin' },
  };
}

describe('VendorsAdminService', () => {
  let prisma: any;
  let service: VendorsAdminService;
  let status: VendorStatus;
  let ownerActive: boolean;

  beforeEach(() => {
    status = VendorStatus.PENDING;
    ownerActive = true;
    prisma = {
      vendor: {
        findUnique: jest.fn(({ select }) =>
          Promise.resolve(select ? { status, userId: 'u1' } : fullRow(status)),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(({ data }) => {
          status = data.status;
          return Promise.resolve({ count: 1 });
        }),
      },
      user: {
        findUniqueOrThrow: jest.fn(() => Promise.resolve({ isActive: ownerActive })),
        update: jest.fn(),
      },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prisma)
          : Promise.all(arg as unknown[]),
      ),
    };
    service = new VendorsAdminService(prisma, { publicUrl: (k: string) => k } as any);
  });

  const run = (action: AdminAction) =>
    action === 'reject' ? service.reject(ADMIN, 'v1', 'Bad phone') : service[action](ADMIN, 'v1');

  describe.each(ACTIONS)('%s', (action) => {
    const { from, to } = ADMIN_TRANSITIONS[action];

    it(`moves ${from} → ${to} and records the reviewer`, async () => {
      status = from;
      const res = await run(action);
      expect(res.status).toBe(to);
      expect(prisma.vendor.updateMany).toHaveBeenCalledWith({
        where: { id: 'v1', status: from },
        data: expect.objectContaining({
          status: to,
          reviewedById: ADMIN,
          reviewedAt: expect.any(Date),
        }),
      });
    });

    it.each(ALL_STATUSES.filter((s) => s !== from))('refuses from %s with 409', async (current) => {
      status = current;
      await expect(run(action)).rejects.toThrow(
        new ConflictException(`Cannot ${action} a shop that is ${current}`),
      );
      expect(prisma.vendor.updateMany).not.toHaveBeenCalled();
    });
  });

  it('404s an unknown shop', async () => {
    prisma.vendor.findUnique.mockResolvedValue(null);
    await expect(service.approve(ADMIN, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approve promotes the owner to VENDOR inside the transaction', async () => {
    await service.approve(ADMIN, 'v1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'VENDOR' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it('refuses to approve a deactivated owner', async () => {
    ownerActive = false;
    await expect(service.approve(ADMIN, 'v1')).rejects.toThrow('Owner account is deactivated');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.vendor.updateMany).not.toHaveBeenCalled();
  });

  it('reject stores the reason', async () => {
    await service.reject(ADMIN, 'v1', 'Bad phone');
    expect(prisma.vendor.updateMany.mock.calls[0][0].data.rejectionReason).toBe('Bad phone');
  });

  it('builds list filters', () => {
    expect(
      VendorsAdminService.listWhere({ page: 1, limit: 20, status: 'PENDING', search: 'mwa' }),
    ).toEqual({ status: 'PENDING', shopName: { contains: 'mwa', mode: 'insensitive' } });
    expect(VendorsAdminService.listWhere({ page: 1, limit: 20 })).toEqual({});
  });
});
