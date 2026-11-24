import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingStatus, ListingType, Species } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IsReason } from '../../common/validators';

export class AdminListListingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ListingStatus, description: 'Omit for every status' })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Shop id' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species)
  species?: Species;

  @ApiPropertyOptional({ enum: ListingType })
  @IsOptional()
  @IsEnum(ListingType)
  listingType?: ListingType;
}

export class TakeDownListingDto {
  @ApiProperty({ minLength: 1, maxLength: 500, example: 'Photos do not match the animal offered.' })
  @IsReason()
  reason: string;
}
