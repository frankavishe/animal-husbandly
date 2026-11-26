import { Order, OrderActorType, Prisma } from '@prisma/client';
import {
  AdminOrderDto,
  AdminSubOrderDto,
  CustomerOrderDto,
  CustomerSubOrderDto,
  OrderAddressDto,
  OrderHistoryDto,
  OrderItemDto,
  PublicActor,
  SubOrderDto,
  VendorOrderDto,
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

/** A sub-order with the order fields a vendor may see. */
export const vendorSubOrderInclude = {
  ...subOrderInclude,
  order: {
    select: {
      seq: true,
      paymentMethod: true,
      recipientName: true,
      contactPhone: true,
      regionName: true,
      districtName: true,
      wardStreet: true,
      landmark: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SubOrderInclude;

export type VendorSubOrder = Prisma.SubOrderGetPayload<{ include: typeof vendorSubOrderInclude }>;

export function toVendorOrder(s: VendorSubOrder): VendorOrderDto {
  return {
    ...toSubOrder(s),
    orderNumber: orderNumber(s.order.seq),
    paymentMethod: s.order.paymentMethod,
    deliveryAddress: toAddress(s.order),
    createdAt: s.order.createdAt,
  };
}

/** Administrators see everything, including who acted (FR-026). */
export function toAdminOrder(o: OrderWithRelations): AdminOrderDto {
  return {
    id: o.id,
    orderNumber: orderNumber(o.seq),
    status: overallStatus(o.subOrders.map((s) => s.status)),
    paymentMethod: o.paymentMethod,
    total: Number(o.total),
    deliveryAddress: toAddress(o),
    createdAt: o.createdAt,
    customer: {
      id: o.customer.id,
      fullName: o.customer.fullName,
      phone: o.customer.phone,
      email: o.customer.email,
    },
    subOrders: o.subOrders.map((s): AdminSubOrderDto => ({
      ...toSubOrder(s),
      history: s.history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actor: h.actorType,
        actorUser: h.actor ? { id: h.actor.id, fullName: h.actor.fullName } : null,
        reason: h.reason,
        createdAt: h.createdAt,
      })),
      vendor: { id: s.vendor.id, slug: s.vendor.slug, shopName: s.vendor.shopName },
    })),
  };
}
