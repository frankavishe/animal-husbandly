import { ApiProperty } from '@nestjs/swagger';
import {
  AnimalSex,
  ListingStatus,
  ListingType,
  ListingUnit,
  Species,
  VendorStatus,
} from '@prisma/client';
import { NamedRefDto, UserRefDto } from '../../vendors/dto/vendor-response.dto';

export class AnimalDto {
  @ApiProperty({ example: 'Boran' }) breed: string;
  @ApiProperty({ enum: AnimalSex }) sex: AnimalSex;
  @ApiProperty({ example: 30 }) ageMonths: number;
  @ApiProperty({ type: Number, nullable: true, example: 350.5 }) weightKg: number | null;
}

export class PhotoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() url: string;
  @ApiProperty({ minimum: 0, maximum: 4 }) position: number;
}

export class ShopSummaryDto {
  @ApiProperty({ example: 'mwanza-cattle' }) slug: string;
  @ApiProperty({ example: 'Mwanza Cattle' }) shopName: string;
  @ApiProperty({ type: NamedRefDto }) region: NamedRefDto;
  @ApiProperty({ type: NamedRefDto }) district: NamedRefDto;
}

/** FR-019: the only fields anyone may see about a listing. */
export class PublicListingDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Boran heifer' }) title: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: Species }) species: Species;
  @ApiProperty({ enum: ListingType }) listingType: ListingType;
  @ApiProperty({ enum: ListingUnit }) unit: ListingUnit;
  @ApiProperty({ description: 'Whole TZS per unit', example: 1200000 }) unitPrice: number;
  @ApiProperty({ example: 3 }) stockQuantity: number;
  @ApiProperty() inStock: boolean;
  @ApiProperty({ type: AnimalDto, nullable: true }) animal: AnimalDto | null;
  @ApiProperty({ type: [PhotoDto] }) photos: PhotoDto[];
  @ApiProperty({ type: String, nullable: true }) coverUrl: string | null;
  @ApiProperty({ type: Date, nullable: true }) publishedAt: Date | null;
  @ApiProperty({ type: ShopSummaryDto }) shop: ShopSummaryDto;
}

export class OwnerListingDto extends PublicListingDto {
  @ApiProperty({ enum: ListingStatus }) status: ListingStatus;
  @ApiProperty({ type: String, nullable: true }) takenDownReason: string | null;
  @ApiProperty({ type: Date, nullable: true }) takenDownAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) archivedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ListingVendorRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() slug: string;
  @ApiProperty() shopName: string;
  @ApiProperty({ enum: VendorStatus }) status: VendorStatus;
}

export class AdminListingDto extends OwnerListingDto {
  @ApiProperty({ type: ListingVendorRefDto }) vendor: ListingVendorRefDto;
  @ApiProperty({ type: UserRefDto, nullable: true }) takenDownBy: UserRefDto | null;
}

class PageMetaDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class PaginatedPublicListingsDto extends PageMetaDto {
  @ApiProperty({ type: [PublicListingDto] }) items: PublicListingDto[];
}

export class PaginatedOwnerListingsDto extends PageMetaDto {
  @ApiProperty({ type: [OwnerListingDto] }) items: OwnerListingDto[];
}

export class PaginatedAdminListingsDto extends PageMetaDto {
  @ApiProperty({ type: [AdminListingDto] }) items: AdminListingDto[];
}
