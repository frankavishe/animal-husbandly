import { Prisma, VendorPayoutAccount } from '@prisma/client';
import { StorageService } from '../common/storage';
import {
  AdminVendorDto,
  OwnerVendorDto,
  PayoutAccountDto,
  PublicVendorDto,
} from './dto/vendor-response.dto';

/** Everything any vendor view needs, loaded in one query. */
export const vendorInclude = {
  region: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  payoutAccount: true,
  user: { select: { id: true, fullName: true, phone: true, email: true, isActive: true } },
  reviewedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.VendorInclude;

export type VendorWithRelations = Prisma.VendorGetPayload<{ include: typeof vendorInclude }>;

export function toPayoutAccount(p: VendorPayoutAccount): PayoutAccountDto {
  const base = { method: p.method, accountName: p.accountName, updatedAt: p.updatedAt };
  return p.method === 'MOBILE_MONEY'
    ? { ...base, provider: p.provider!, mobileNumber: p.mobileNumber! }
    : { ...base, bankName: p.bankName!, accountNumber: p.accountNumber! };
}

/** Explicit whitelist (FR-019): new columns never leak publicly by accident. */
export function toPublicVendor(v: VendorWithRelations, storage: StorageService): PublicVendorDto {
  return {
    slug: v.slug,
    shopName: v.shopName,
    description: v.description,
    region: { id: v.region.id, name: v.region.name },
    district: { id: v.district.id, name: v.district.name },
    businessPhone: v.businessPhone,
    species: v.species,
    logoUrl: v.logoKey ? storage.publicUrl(v.logoKey) : null,
    joinedAt: v.createdAt,
  };
}

export function toOwnerVendor(v: VendorWithRelations, storage: StorageService): OwnerVendorDto {
  return {
    ...toPublicVendor(v, storage),
    id: v.id,
    status: v.status,
    rejectionReason: v.rejectionReason,
    submittedAt: v.submittedAt,
    reviewedAt: v.reviewedAt,
    payoutAccount: v.payoutAccount ? toPayoutAccount(v.payoutAccount) : null,
  };
}

export function toAdminVendor(v: VendorWithRelations, storage: StorageService): AdminVendorDto {
  return {
    ...toOwnerVendor(v, storage),
    owner: {
      id: v.user.id,
      fullName: v.user.fullName,
      phone: v.user.phone,
      email: v.user.email,
      isActive: v.user.isActive,
    },
    reviewedBy: v.reviewedBy ? { id: v.reviewedBy.id, fullName: v.reviewedBy.fullName } : null,
    createdAt: v.createdAt,
  };
}
