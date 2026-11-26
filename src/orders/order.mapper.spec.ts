import { OrderActorType, SubOrderStatus } from '@prisma/client';
import { toCustomerOrder, toVendorOrder } from './order.mapper';
import { orderFixture, T0, vendorSubOrderFixture } from './order.fixtures-spec';

describe('toCustomerOrder', () => {
  it('maps numbers, order number, address and overall status', () => {
    const dto = toCustomerOrder(orderFixture());
    expect(dto).toMatchObject({
      id: 'order-1',
      orderNumber: 'ORD-00000042',
      status: 'OPEN',
      paymentMethod: 'CASH_ON_DELIVERY',
      total: 3_000_000,
      deliveryAddress: {
        recipientName: 'Asha Mushi',
        contactPhone: '+255712345678',
        regionName: 'Arusha',
        districtName: 'Meru',
        wardStreet: 'Sakina',
        landmark: null,
      },
      createdAt: T0,
    });
    expect(dto.subOrders[0]).toMatchObject({
      shopSlug: 'shop-0',
      subtotal: 1_500_000,
      reason: null,
      items: [{ lineTotal: 1_500_000, unitPrice: 750_000, quantity: 2 }],
    });
    expect(typeof dto.total).toBe('number');
  });

  it('shows admins as MARKETPLACE, never actor ids, and the latest reason', () => {
    const dto = toCustomerOrder(
      orderFixture([
        {
          status: SubOrderStatus.CANCELLED,
          history: [{ actorType: OrderActorType.ADMIN, reason: 'Fraud suspected' }],
        },
        {
          status: SubOrderStatus.CANCELLED,
          history: [{ actorType: OrderActorType.MARKETPLACE, reason: 'Late' }],
        },
      ]),
    );
    expect(dto.status).toBe('CANCELLED');
    expect(dto.subOrders[0].history.map((h) => h.actor)).toEqual(['CUSTOMER', 'MARKETPLACE']);
    expect(dto.subOrders[1].history[1].actor).toBe('MARKETPLACE');
    expect(dto.subOrders[0].reason).toBe('Fraud suspected');
    const json = JSON.stringify(dto);
    expect(json).not.toContain('actor-user');
    expect(json).not.toContain('Secret Admin');
    expect(json).not.toContain('ADMIN');
    expect(json).not.toContain('customer-1');
    expect(json).not.toContain('vendor-0');
  });

  it('exposes exactly the contract keys', () => {
    const dto = toCustomerOrder(orderFixture());
    expect(Object.keys(dto).sort()).toEqual([
      'createdAt',
      'deliveryAddress',
      'id',
      'orderNumber',
      'paymentMethod',
      'status',
      'subOrders',
      'total',
    ]);
    expect(Object.keys(dto.subOrders[0]).sort()).toEqual([
      'cashCollectedAt',
      'history',
      'id',
      'items',
      'reason',
      'shopName',
      'shopSlug',
      'status',
      'subtotal',
      'updatedAt',
    ]);
    expect(Object.keys(dto.subOrders[0].items[0]).sort()).toEqual([
      'lineTotal',
      'listingId',
      'listingType',
      'quantity',
      'species',
      'title',
      'unit',
      'unitPrice',
    ]);
    expect(Object.keys(dto.subOrders[0].history[0]).sort()).toEqual([
      'actor',
      'createdAt',
      'fromStatus',
      'reason',
      'toStatus',
    ]);
  });
});

describe('toVendorOrder', () => {
  function vendorSub() {
    return vendorSubOrderFixture(
      orderFixture([
        {
          status: SubOrderStatus.REJECTED,
          history: [{ actorType: OrderActorType.VENDOR, reason: 'No stock left' }],
        },
        { status: SubOrderStatus.PENDING },
      ]),
    );
  }

  it('shows the own part, order number and delivery details, with the latest reason', () => {
    const dto = toVendorOrder(vendorSub());
    expect(dto).toMatchObject({
      id: 'sub-0',
      orderNumber: 'ORD-00000042',
      paymentMethod: 'CASH_ON_DELIVERY',
      status: 'REJECTED',
      subtotal: 1_500_000,
      reason: 'No stock left',
      deliveryAddress: { recipientName: 'Asha Mushi', contactPhone: '+255712345678' },
      createdAt: T0,
    });
    expect(dto.history.map((h) => h.actor)).toEqual(['CUSTOMER', 'VENDOR']);
  });

  it('exposes no order total, other shops, customer account or actor ids', () => {
    const dto = toVendorOrder(vendorSub());
    expect(Object.keys(dto).sort()).toEqual([
      'cashCollectedAt',
      'createdAt',
      'deliveryAddress',
      'history',
      'id',
      'items',
      'orderNumber',
      'paymentMethod',
      'reason',
      'shopName',
      'status',
      'subtotal',
      'updatedAt',
    ]);
    const json = JSON.stringify(dto);
    for (const hidden of ['customer-1', 'actor-user', 'sub-1', 'Shop 1', '3000000', 'order-1']) {
      expect(json).not.toContain(hidden);
    }
  });

  it('shows an admin cancellation as MARKETPLACE', () => {
    const dto = toVendorOrder(
      vendorSubOrderFixture(
        orderFixture([
          {
            status: SubOrderStatus.CANCELLED,
            history: [{ actorType: OrderActorType.ADMIN, reason: 'Fraud' }],
          },
        ]),
      ),
    );
    expect(dto.history[1].actor).toBe('MARKETPLACE');
    expect(JSON.stringify(dto)).not.toContain('Secret Admin');
  });
});
