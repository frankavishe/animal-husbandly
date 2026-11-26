import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderActorType, PaymentMethod, SubOrderStatus } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { OverallStatus } from '../order-status';
import { OrderAddressDto, OrderItemDto, PageMetaDto } from './order-response.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class AdminListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OverallStatus, description: 'Overall order status' })
  @IsOptional()
  @IsEnum(OverallStatus)
  status?: OverallStatus;

  @ApiPropertyOptional({
    enum: SubOrderStatus,
    description: 'Some sub-order has this status (the shop’s own, when vendorId is given)',
  })
  @IsOptional()
  @IsEnum(SubOrderStatus)
  subOrderStatus?: SubOrderStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Shop id' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'Placed on or after (UTC date)' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be a date (YYYY-MM-DD)' })
  @IsISO8601({ strict: true }, { message: 'from must be a valid date' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Placed on or before (UTC date, whole day)',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be a date (YYYY-MM-DD)' })
  @IsISO8601({ strict: true }, { message: 'to must be a valid date' })
  to?: string;
}

export class AdminActorUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
}

export class AdminOrderHistoryDto {
  @ApiProperty({ enum: SubOrderStatus, nullable: true }) fromStatus: SubOrderStatus | null;
  @ApiProperty({ enum: SubOrderStatus }) toStatus: SubOrderStatus;
  @ApiProperty({ enum: OrderActorType }) actor: OrderActorType;
  @ApiProperty({ type: AdminActorUserDto, nullable: true, description: 'Null for MARKETPLACE' })
  actorUser: AdminActorUserDto | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty() createdAt: Date;
}

export class AdminOrderVendorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() slug: string;
  @ApiProperty() shopName: string;
}

export class AdminSubOrderDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() shopName: string;
  @ApiProperty({ enum: SubOrderStatus }) status: SubOrderStatus;
  @ApiProperty() subtotal: number;
  @ApiProperty({ type: [OrderItemDto] }) items: OrderItemDto[];
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: Date, nullable: true }) cashCollectedAt: Date | null;
  @ApiProperty({ type: [AdminOrderHistoryDto] }) history: AdminOrderHistoryDto[];
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: AdminOrderVendorDto }) vendor: AdminOrderVendorDto;
}

export class AdminOrderCustomerDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
}

export class AdminOrderDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'ORD-00000042' }) orderNumber: string;
  @ApiProperty({ enum: OverallStatus }) status: OverallStatus;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod: PaymentMethod;
  @ApiProperty() total: number;
  @ApiProperty({ type: OrderAddressDto }) deliveryAddress: OrderAddressDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: AdminOrderCustomerDto }) customer: AdminOrderCustomerDto;
  @ApiProperty({ type: [AdminSubOrderDto] }) subOrders: AdminSubOrderDto[];
}

export class PaginatedAdminOrdersDto extends PageMetaDto {
  @ApiProperty({ type: [AdminOrderDto] }) items: AdminOrderDto[];
}
