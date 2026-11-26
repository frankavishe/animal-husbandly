import { Order, OrderActorType, Prisma } from '@prisma/client';
import {
  CustomerOrderDto,
  CustomerSubOrderDto,
  OrderAddressDto,
  OrderHistoryDto,
  OrderItemDto,
  PublicActor,
  SubOrderDto,
} from './dto';
import { orderNumber, overallStatus } from './order-status';

const historyInclude = {
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  include: { actor: { select: { id: true, fullName: true } } },
} satisfies Prisma.SubOrder$historyArgs;

export const subOrderInclude = {
  items: { orderBy: [{ title: 'asc' }, { listingId: 'asc' }] },
  history: historyInclude,
  vendor: { select: { id: true, slug: true, shopName: true } },
} satisfies Prisma.SubOrderInclude;

/** Everything any of the three views needs; the mappers decide what each audience sees. */
export const orderInclude = {
  customer: { select: { id: true, fullName: true, phone: true, email: true } },
  subOrders: {
    orderBy: [{ shopName: 'asc' }, { id: 'asc' }],
    include: subOrderInclude,
  },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
export type SubOrderWithRelations = OrderWithRelations['subOrders'][number];
export type HistoryWithActor = SubOrderWithRelations['history'][number];

export function toAddress(
  o: Pick<
    Order,
    'recipientName' | 'contactPhone' | 'regionName' | 'districtName' | 'wardStreet' | 'landmark'
  >,
): OrderAddressDto {
  return {
    recipientName: o.recipientName,
    contactPhone: o.contactPhone,
    regionName: o.regionName,
    districtName: o.districtName,
    wardStreet: o.wardStreet,
    landmark: o.landmark,
  };
}

function toItem(i: SubOrderWithRelations['items'][number]): OrderItemDto {
  return {
    listingId: i.listingId,
    title: i.title,
    species: i.species,
    listingType: i.listingType,
    unit: i.unit,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    lineTotal: Number(i.lineTotal),
  };
}

/** FR-025: administrators and automatic changes are both "the marketplace"; no actor ids. */
export function publicActor(type: OrderActorType): PublicActor {
  return type === OrderActorType.CUSTOMER || type === OrderActorType.VENDOR
    ? type
    : PublicActor.MARKETPLACE;
}

function toPublicHistory(h: HistoryWithActor): OrderHistoryDto {
  return {
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    actor: publicActor(h.actorType),
    reason: h.reason,
    createdAt: h.createdAt,
  };
}

/** The reason shown on a sub-order is the one on its latest history entry. */
export function latestReason(s: Pick<SubOrderWithRelations, 'history'>): string | null {
  return s.history.length ? s.history[s.history.length - 1].reason : null;
}

/** The sub-order fields every audience sees, with history in the public (actor-less) form. */
export function toSubOrder(s: SubOrderWithRelations): SubOrderDto {
  return {
    id: s.id,
    shopName: s.shopName,
    status: s.status,
    subtotal: Number(s.subtotal),
    items: s.items.map(toItem),
    reason: latestReason(s),
    cashCollectedAt: s.cashCollectedAt,
    history: s.history.map(toPublicHistory),
    updatedAt: s.updatedAt,
  };
}

export function toCustomerOrder(o: OrderWithRelations): CustomerOrderDto {
  return {
    id: o.id,
    orderNumber: orderNumber(o.seq),
    status: overallStatus(o.subOrders.map((s) => s.status)),
    paymentMethod: o.paymentMethod,
    total: Number(o.total),
    deliveryAddress: toAddress(o),
    subOrders: o.subOrders.map((s): CustomerSubOrderDto => ({
      ...toSubOrder(s),
      shopSlug: s.vendor.slug,
    })),
    createdAt: o.createdAt,
  };
}
