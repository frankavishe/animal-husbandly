import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AnimalSex, ListingStatus, ListingType, ListingUnit, Species } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Trim } from '../../common/validators';

export const MAX_UNIT_PRICE = 1_000_000_000;
export const MAX_STOCK = 1_000_000;

export class CreateListingDto {
  @ApiProperty({ minLength: 3, maxLength: 120, example: 'Boran heifer' })
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ maxLength: 2000, example: 'Healthy, vaccinated, ready for breeding.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: Species })
  @IsEnum(Species)
  species: Species;

  @ApiProperty({ enum: ListingType, description: 'MILK only for CATTLE, EGGS only for CHICKEN' })
  @IsEnum(ListingType)
  listingType: ListingType;

  @ApiProperty({
    enum: ListingUnit,
    description: 'LIVE_ANIMAL: HEAD/KG; MEAT: KG/PIECE; MILK: LITRE; EGGS: PIECE/TRAY (30 eggs)',
  })
  @IsEnum(ListingUnit)
  unit: ListingUnit;

  @ApiProperty({ minimum: 1, maximum: MAX_UNIT_PRICE, description: 'Whole TZS', example: 1200000 })
  @IsInt()
  @Min(1)
  @Max(MAX_UNIT_PRICE)
  unitPrice: number;

  @ApiProperty({ minimum: 0, maximum: MAX_STOCK, example: 3 })
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  stockQuantity: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 2,
    maxLength: 60,
    example: 'Boran',
    description: 'LIVE_ANIMAL only (required there). `null` on PATCH clears it.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  breed?: string | null;

  @ApiPropertyOptional({
    enum: AnimalSex,
    nullable: true,
    description: 'LIVE_ANIMAL only (required there); MIXED for mixed groups',
  })
  @IsOptional()
  @IsEnum(AnimalSex)
  sex?: AnimalSex | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 600,
    example: 30,
    description: 'LIVE_ANIMAL only (required there)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  ageMonths?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0.1,
    maximum: 2000,
    example: 350.5,
    description: 'LIVE_ANIMAL only, optional, steps of 0.1 kg',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1, allowNaN: false, allowInfinity: false })
  @Min(0.1)
  @Max(2000)
  weightKg?: number | null;
}

/**
 * All fields optional. `null` for breed/sex/ageMonths/weightKg means "clear"
 * (`@IsOptional` skips validation for null); `null` for any other field means "not sent".
 */
export class UpdateListingDto extends PartialType(CreateListingDto) {}

export class VendorListListingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ListingStatus,
    description: 'ARCHIVED listings are only returned when asked for explicitly',
  })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;
}
