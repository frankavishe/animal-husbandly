import { ApiProperty } from '@nestjs/swagger';
import { ListingUnit } from '@prisma/client';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export const MAX_LINE_QUANTITY = 1_000_000;

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId: string;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_LINE_QUANTITY,
    example: 2,
    description: 'Added to any existing line',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

export class SetCartItemDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_LINE_QUANTITY,
    example: 4,
    description: 'Replaces the line quantity',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

export const CartFlag = {
  UNAVAILABLE: 'UNAVAILABLE',
  SHORT_OF_STOCK: 'SHORT_OF_STOCK',
  PRICE_CHANGED: 'PRICE_CHANGED',
} as const;
export type CartFlag = (typeof CartFlag)[keyof typeof CartFlag];

export class CartLineDto {
  @ApiProperty({ format: 'uuid' }) listingId: string;
  @ApiProperty({ example: 'Boran heifer' }) title: string;
  @ApiProperty({ enum: ListingUnit }) unit: ListingUnit;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Current price; null when unavailable',
  })
  unitPrice: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Null when unavailable' })
  lineTotal: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Current stock; null when unavailable',
  })
  stockLeft: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Price last seen; only with PRICE_CHANGED',
  })
  previousPrice: number | null;
  @ApiProperty({ enum: CartFlag, isArray: true }) flags: CartFlag[];
}

export class CartShopRefDto {
  @ApiProperty({ example: 'mwanza-cattle' }) slug: string;
  @ApiProperty({ example: 'Mwanza Cattle' }) shopName: string;
}

export class CartShopDto {
  @ApiProperty({ type: CartShopRefDto }) shop: CartShopRefDto;
  @ApiProperty({ type: [CartLineDto] }) lines: CartLineDto[];
  @ApiProperty({ description: 'Whole TZS, excluding unavailable lines' }) subtotal: number;
}

export class CartDto {
  @ApiProperty({ type: [CartShopDto] }) shops: CartShopDto[];
  @ApiProperty({ description: 'Whole TZS, excluding unavailable lines' }) total: number;
  @ApiProperty({ description: 'Number of lines, including unavailable ones' }) lineCount: number;
  @ApiProperty({ description: 'True when the total is above the maximum order total' })
  exceedsMaxTotal: boolean;
}
