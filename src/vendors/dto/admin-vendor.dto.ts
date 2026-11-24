import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IsReason, Trim } from '../../common/validators';

export class AdminListVendorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VendorStatus })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiPropertyOptional({ description: 'Matches shop name (case-insensitive)' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;
}

export class RejectVendorDto {
  @ApiProperty({ minLength: 1, maxLength: 500, example: 'Business phone could not be reached.' })
  @IsReason()
  reason: string;
}
