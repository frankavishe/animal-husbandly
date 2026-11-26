import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId: string;

  @ApiProperty({ minimum: 1, maximum: 1_000_000, example: 2 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  @ApiProperty({
    minimum: 1,
    maximum: 1_000_000_000,
    example: 1200000,
    description: 'The unit price the buyer saw (whole TZS); the order is placed at this price',
  })
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  unitPrice: number;
}

export class CheckoutDto {
  @ApiProperty({ format: 'uuid', description: 'One of your saved addresses' })
  @IsUUID()
  addressId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Generated once per checkout attempt; repeating it returns the same order',
  })
  @IsUUID()
  submissionKey: string;

  @ApiProperty({
    type: [CheckoutLineDto],
    minItems: 1,
    maxItems: 50,
    description: 'Every cart line exactly as shown (listing, quantity, current unit price)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique((l: CheckoutLineDto) => l?.listingId, {
    message: 'lines must have distinct listings',
  })
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines: CheckoutLineDto[];
}
