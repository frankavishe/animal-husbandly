import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MobileMoneyProvider, PayoutMethod, Species, VendorStatus } from '@prisma/client';

export class NamedRefDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

export class UserRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
}

export class VendorOwnerDto extends UserRefDto {
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty() isActive: boolean;
}

/** One payout account; mobile-money or bank fields are present depending on `method`. */
export class PayoutAccountDto {
  @ApiProperty({ enum: PayoutMethod }) method: PayoutMethod;
  @ApiPropertyOptional({ enum: MobileMoneyProvider }) provider?: MobileMoneyProvider;
  @ApiPropertyOptional({ example: '+255754123456' }) mobileNumber?: string;
  @ApiPropertyOptional({ example: 'CRDB Bank' }) bankName?: string;
  @ApiPropertyOptional({ example: '0150123456700' }) accountNumber?: string;
  @ApiProperty({ example: 'Juma Hamisi' }) accountName: string;
  @ApiProperty() updatedAt: Date;
}

/** FR-019: the only fields anyone may see about a shop. */
export class PublicVendorDto {
  @ApiProperty({ example: 'mwanza-cattle' }) slug: string;
  @ApiProperty({ example: 'Mwanza Cattle' }) shopName: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: NamedRefDto }) region: NamedRefDto;
  @ApiProperty({ type: NamedRefDto }) district: NamedRefDto;
  @ApiProperty({ example: '+255754123456' }) businessPhone: string;
  @ApiProperty({ enum: Species, isArray: true }) species: Species[];
  @ApiProperty({ type: String, nullable: true }) logoUrl: string | null;
  @ApiProperty() joinedAt: Date;
}

export class OwnerVendorDto extends PublicVendorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: VendorStatus }) status: VendorStatus;
  @ApiProperty({ type: String, nullable: true }) rejectionReason: string | null;
  @ApiProperty() submittedAt: Date;
  @ApiProperty({ type: Date, nullable: true }) reviewedAt: Date | null;
  @ApiProperty({ type: PayoutAccountDto, nullable: true }) payoutAccount: PayoutAccountDto | null;
}

export class AdminVendorDto extends OwnerVendorDto {
  @ApiProperty({ type: VendorOwnerDto }) owner: VendorOwnerDto;
  @ApiProperty({ type: UserRefDto, nullable: true }) reviewedBy: UserRefDto | null;
  @ApiProperty() createdAt: Date;
}

class PageMetaDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class PaginatedPublicVendorsDto extends PageMetaDto {
  @ApiProperty({ type: [PublicVendorDto] }) items: PublicVendorDto[];
}

export class PaginatedAdminVendorsDto extends PageMetaDto {
  @ApiProperty({ type: [AdminVendorDto] }) items: AdminVendorDto[];
}
