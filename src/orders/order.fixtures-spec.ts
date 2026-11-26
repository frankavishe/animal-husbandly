import { OrderActorType, SubOrderStatus } from '@prisma/client';
import { OrderWithRelations } from './order.mapper';

/** Test-only: a fully loaded order as `orderInclude` returns it. */
export const T0 = new Date('2026-11-20T10:00:00Z');
export const T1 = new Date('2026-11-20T11:00:00Z');

export function orderFixture(
  subOrders: {
    status: SubOrderStatus;
    history?: { actorType: OrderActorType; reason?: string }[];
  }[] = [{ status: SubOrderStatus.PENDING }],
): OrderWithRelations {
  return {
    id: 'order-1',
    seq: 42,
    customerId: 'customer-1',
    recipientName: 'Asha Mushi',
    contactPhone: '+255712345678',
    regionName: 'Arusha',
    districtName: 'Meru',
    wardStreet: 'Sakina',
    landmark: null,
    paymentMethod: 'CASH_ON_DELIVERY',
    total: 3_000_000n,
    submissionKey: 'key',
    submissionHash: 'hash',
    createdAt: T0,
    customer: { id: 'customer-1', fullName: 'Asha', phone: '+255712345678', email: null },
    subOrders: subOrders.map((s, i) => ({
      id: `sub-${i}`,
      orderId: 'order-1',
      vendorId: `vendor-${i}`,
      shopName: `Shop ${i}`,
      subtotal: 1_500_000n,
      status: s.status,
      cashCollectedAt: s.status === SubOrderStatus.DELIVERED ? T1 : null,
      createdAt: T0,
      updatedAt: T1,
      vendor: { id: `vendor-${i}`, slug: `shop-${i}`, shopName: `Shop ${i}` },
      items: [
        {
          id: `item-${i}`,
          subOrderId: `sub-${i}`,
          listingId: `listing-${i}`,
          title: 'Boran heifer',
          species: 'CATTLE',
          listingType: 'LIVE_ANIMAL',
          unit: 'HEAD',
          unitPrice: 750_000,
          quantity: 2,
          lineTotal: 1_500_000n,
        },
      ],
      history: [
        {
          id: `h-${i}-0`,
          subOrderId: `sub-${i}`,
          fromStatus: null,
          toStatus: SubOrderStatus.PENDING,
          actorType: OrderActorType.CUSTOMER,
          actorId: 'customer-1',
          actor: { id: 'customer-1', fullName: 'Asha' },
          reason: null,
          createdAt: T0,
        },
        ...(s.history ?? []).map((h, j) => ({
          id: `h-${i}-${j + 1}`,
          subOrderId: `sub-${i}`,
          fromStatus: SubOrderStatus.PENDING,
          toStatus: s.status,
          actorType: h.actorType,
          actorId: h.actorType === OrderActorType.MARKETPLACE ? null : 'actor-user',
          actor:
            h.actorType === OrderActorType.MARKETPLACE
              ? null
              : { id: 'actor-user', fullName: 'Secret Admin' },
          reason: h.reason ?? null,
          createdAt: T1,
        })),
      ],
    })),
  };
}
