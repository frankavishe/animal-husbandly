import { ApiPropertyOptional } from '@nestjs/swagger';
import { ListingType, Species } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Trim } from '../../common/validators';
import { MAX_UNIT_PRICE } from './create-listing.dto';

export const LISTING_SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

/** `'true'`/`'false'` → boolean; anything else is left as-is so @IsBoolean rejects it. */
const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

export class PublicListListingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species)
  species?: Species;

  @ApiPropertyOptional({ enum: ListingType })
  @IsOptional()
  @IsEnum(ListingType)
  listingType?: ListingType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  regionId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId?: number;

  @ApiPropertyOptional({ description: 'Shop slug' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  shop?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_UNIT_PRICE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_UNIT_PRICE)
  minPrice?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_UNIT_PRICE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_UNIT_PRICE)
  maxPrice?: number;

  @ApiPropertyOptional({ type: Boolean, description: 'true = only listings with stock above 0' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({ description: 'Case-insensitive match on title or description' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: LISTING_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(LISTING_SORTS)
  sort: ListingSort = 'newest';
}
