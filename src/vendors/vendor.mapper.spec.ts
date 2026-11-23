import { toAdminVendor, toPublicVendor, VendorWithRelations } from './vendor.mapper';

const vendor = {
  id: 'v1',
  userId: 'u1',
  shopName: 'Shop',
  slug: 'shop',
  description: 'd',
  regionId: 1,
  districtId: 1,
  businessPhone: '+255754123456',
  species: ['CATTLE'],
  logoKey: 'vendors/v1/logo.png',
  status: 'APPROVED',
  rejectionReason: 'secret',
  submittedAt: new Date(),
  reviewedById: 'a1',
  reviewedAt: new Date(),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date(),
  region: { id: 1, name: 'Arusha' },
  district: { id: 1, name: 'Arusha City' },
  payoutAccount: {
    id: 'p1',
    vendorId: 'v1',
    method: 'MOBILE_MONEY',
    provider: 'MPESA',
    mobileNumber: '+255754123456',
    bankName: null,
    accountNumber: null,
    accountName: 'Juma',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  user: { id: 'u1', fullName: 'Juma', phone: '+255754000000', email: 'j@x.tz', isActive: true },
  reviewedBy: { id: 'a1', fullName: 'Admin' },
} as unknown as VendorWithRelations;

const storage = { publicUrl: (k: string) => `http://cdn/${k}` } as any;

describe('vendor mapper', () => {
  it('public view exposes exactly the FR-019 fields', () => {
    const pub = toPublicVendor(vendor, storage);
    expect(Object.keys(pub).sort()).toEqual(
      [
        'businessPhone',
        'description',
        'district',
        'joinedAt',
        'logoUrl',
        'region',
        'shopName',
        'slug',
        'species',
      ].sort(),
    );
    expect(pub.logoUrl).toBe('http://cdn/vendors/v1/logo.png');
    expect(pub.joinedAt).toEqual(new Date('2026-01-01'));
  });

  it('admin view includes owner, reviewer and the mobile-money payout only', () => {
    const admin = toAdminVendor(vendor, storage);
    expect(admin.owner.email).toBe('j@x.tz');
    expect(admin.reviewedBy).toEqual({ id: 'a1', fullName: 'Admin' });
    expect(admin.payoutAccount).toMatchObject({ method: 'MOBILE_MONEY', provider: 'MPESA' });
    expect(admin.payoutAccount).not.toHaveProperty('bankName');
  });
});
