import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Species } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { IsTzPhone, Trim } from '../../common/validators';

export class ApplyVendorDto {
  @ApiProperty({ minLength: 2, maxLength: 80, example: 'Mwanza Cattle' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  shopName: string;

  @ApiPropertyOptional({ maxLength: 1000, example: 'Healthy zebu cattle and goats from Mwanza.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  regionId: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId: number;

  @ApiProperty({ example: '0754123456', description: 'Tanzanian mobile number' })
  @IsTzPhone()
  businessPhone: string;

  @ApiProperty({ enum: Species, isArray: true, example: ['CATTLE', 'GOAT'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(Species, { each: true })
  species: Species[];
}

/** All fields optional; `species`, when sent, must still be a non-empty unique list. */
export class UpdateVendorDto extends PartialType(ApplyVendorDto) {}
