import { ApiProperty } from '@nestjs/swagger';
import { ListingType, ListingUnit, PaymentMethod, Species, SubOrderStatus } from '@prisma/client';
import { OverallStatus } from '../order-status';

/** The delivery address as copied at checkout. */
export class OrderAddressDto {
  @ApiProperty({ example: 'Asha Mushi' }) recipientName: string;
  @ApiProperty({ example: '+255712345678' }) contactPhone: string;
  @ApiProperty({ example: 'Arusha' }) regionName: string;
  @ApiProperty({ example: 'Meru' }) districtName: string;
  @ApiProperty({ example: 'Sakina, Mianzini Street' }) wardStreet: string;
  @ApiProperty({ type: String, nullable: true }) landmark: string | null;
}

export class OrderItemDto {
  @ApiProperty({ format: 'uuid' }) listingId: string;
  @ApiProperty({ example: 'Boran heifer' }) title: string;
  @ApiProperty({ enum: Species }) species: Species;
  @ApiProperty({ enum: ListingType }) listingType: ListingType;
  @ApiProperty({ enum: ListingUnit }) unit: ListingUnit;
  @ApiProperty({ example: 1200000 }) unitPrice: number;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ example: 2400000 }) lineTotal: number;
}

export const PublicActor = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  MARKETPLACE: 'MARKETPLACE',
} as const;
export type PublicActor = (typeof PublicActor)[keyof typeof PublicActor];

export class OrderHistoryDto {
  @ApiProperty({ enum: SubOrderStatus, nullable: true, description: 'Null for placement' })
  fromStatus: SubOrderStatus | null;
  @ApiProperty({ enum: SubOrderStatus }) toStatus: SubOrderStatus;
  @ApiProperty({
    enum: PublicActor,
    description: 'Administrators and automatic changes are shown as MARKETPLACE',
  })
  actor: PublicActor;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty() createdAt: Date;
}

export class SubOrderDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Mwanza Cattle' }) shopName: string;
  @ApiProperty({ enum: SubOrderStatus }) status: SubOrderStatus;
  @ApiProperty({ description: 'Whole TZS' }) subtotal: number;
  @ApiProperty({ type: [OrderItemDto] }) items: OrderItemDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Reason of the latest status change (rejection or cancellation)',
  })
  reason: string | null;
  @ApiProperty({ type: Date, nullable: true, description: 'Set when DELIVERED' })
  cashCollectedAt: Date | null;
  @ApiProperty({ type: [OrderHistoryDto] }) history: OrderHistoryDto[];
  @ApiProperty() updatedAt: Date;
}

export class CustomerSubOrderDto extends SubOrderDto {
  @ApiProperty({ example: 'mwanza-cattle' }) shopSlug: string;
}

export class CustomerOrderDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'ORD-00000042' }) orderNumber: string;
  @ApiProperty({ enum: OverallStatus }) status: OverallStatus;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod: PaymentMethod;
  @ApiProperty({ description: 'Whole TZS' }) total: number;
  @ApiProperty({ type: OrderAddressDto }) deliveryAddress: OrderAddressDto;
  @ApiProperty({ type: [CustomerSubOrderDto] }) subOrders: CustomerSubOrderDto[];
  @ApiProperty() createdAt: Date;
}

export class PageMetaDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class PaginatedCustomerOrdersDto extends PageMetaDto {
  @ApiProperty({ type: [CustomerOrderDto] }) items: CustomerOrderDto[];
}
