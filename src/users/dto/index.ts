import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsNormalizedEmail, IsPersonName, IsTzPhone, Trim } from '../../common/validators';

export * from './user-response.dto';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Juma Hamisi' })
  @IsOptional()
  @IsPersonName()
  fullName?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '0712345678',
    description: '`null` clears the phone (only if an email remains)',
  })
  @IsOptional()
  @IsTzPhone()
  phone?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'juma@example.co.tz',
    description: '`null` clears the email (only if a phone remains)',
  })
  @IsOptional()
  @IsNormalizedEmail()
  email?: string | null;
}

export class RegionResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Dar es Salaam' }) name: string;
  @ApiProperty({ example: 'TZ-02' }) code: string;
}

export class DistrictResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Ilala' }) name: string;
  @ApiProperty() regionId: number;
}

export class CreateAddressDto {
  @ApiProperty({ example: 'Home', minLength: 1, maxLength: 50 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label: string;

  @ApiProperty({ example: 'Juma Hamisi' })
  @IsPersonName()
  recipientName: string;

  @ApiProperty({ example: '0712345678' })
  @IsTzPhone()
  contactPhone: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  regionId: number;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  districtId: number;

  @ApiProperty({ example: 'Mchikichini, Mtaa wa Kariakoo' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  wardStreet: string;

  @ApiPropertyOptional({ example: 'Near Kariakoo market' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @ApiPropertyOptional({ description: 'Make this the default address' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

class NamedRefDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

export class AddressResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() label: string;
  @ApiProperty() recipientName: string;
  @ApiProperty() contactPhone: string;
  @ApiProperty({ type: NamedRefDto }) region: NamedRefDto;
  @ApiProperty({ type: NamedRefDto }) district: NamedRefDto;
  @ApiProperty() wardStreet: string;
  @ApiProperty({ type: String, nullable: true }) landmark: string | null;
  @ApiProperty() isDefault: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
