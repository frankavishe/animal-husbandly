import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MobileMoneyProvider, PayoutMethod } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsPersonName, IsTzPhone, Trim } from '../../common/validators';

const isMobile = (o: UpsertPayoutAccountDto) => o.method === PayoutMethod.MOBILE_MONEY;
const isBank = (o: UpsertPayoutAccountDto) => o.method === PayoutMethod.BANK;

/**
 * FR-024/025. Fields of the other method are refused by the service (and the DB CHECK);
 * they are declared here so the whitelist does not report them as unknown.
 */
export class UpsertPayoutAccountDto {
  @ApiProperty({ enum: PayoutMethod })
  @IsEnum(PayoutMethod)
  method: PayoutMethod;

  @ApiProperty({ minLength: 2, maxLength: 100, example: 'Juma Hamisi' })
  @IsPersonName()
  accountName: string;

  @ApiPropertyOptional({ enum: MobileMoneyProvider, description: 'Required for MOBILE_MONEY' })
  @ValidateIf(isMobile)
  @IsEnum(MobileMoneyProvider)
  provider?: MobileMoneyProvider;

  @ApiPropertyOptional({ example: '0754123456', description: 'Required for MOBILE_MONEY' })
  @ValidateIf(isMobile)
  @IsTzPhone()
  mobileNumber?: string;

  @ApiPropertyOptional({ example: 'CRDB Bank', description: 'Required for BANK' })
  @ValidateIf(isBank)
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: '0150123456700', description: 'Required for BANK; 6–30 digits' })
  @ValidateIf(isBank)
  @IsString()
  @Matches(/^\d{6,30}$/, { message: 'accountNumber must be 6–30 digits' })
  accountNumber?: string;
}
