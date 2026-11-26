import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, SubOrderStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IsReason } from '../../common/validators';
import { OrderAddressDto, PageMetaDto, SubOrderDto } from './order-response.dto';

/** FR-020: the shop's own part only; no order total, other shops or customer account. */
export class VendorOrderDto extends SubOrderDto {
  @ApiProperty({ example: 'ORD-00000042' }) orderNumber: string;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod: PaymentMethod;
  @ApiProperty({ type: OrderAddressDto }) deliveryAddress: OrderAddressDto;
  @ApiProperty({ description: 'When the order was placed' }) createdAt: Date;
}

export class PaginatedVendorOrdersDto extends PageMetaDto {
  @ApiProperty({ type: [VendorOrderDto] }) items: VendorOrderDto[];
}

export class VendorListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubOrderStatus })
  @IsOptional()
  @IsEnum(SubOrderStatus)
  status?: SubOrderStatus;
}

/** A required reason of 1–500 characters (reject, vendor cancel, admin cancel). */
export class OrderReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 500, example: 'The animal fell sick.' })
  @IsReason()
  reason: string;
}
