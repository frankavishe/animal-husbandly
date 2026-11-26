import { OrderActorType, SubOrderStatus } from '@prisma/client';
import {
  orderNumber,
  overallStatus,
  overallStatusWhere,
  returnsStock,
  TRANSITIONS,
  TransitionAction,
} from './order-status';

const S = SubOrderStatus;
const ALL_STATUSES = Object.values(S);
const ACTIONS: TransitionAction[] = [
  'confirm',
  'dispatch',
  'deliver',
  'reject',
  'cancel',
  'expire',
];

/** The data-model table, written out independently: actor/action → from → to. */
const EXPECTED: Record<string, Partial<Record<SubOrderStatus, SubOrderStatus>>> = {
  'VENDOR/confirm': { PENDING: S.CONFIRMED },
  'VENDOR/dispatch': { CONFIRMED: S.DISPATCHED },
  'VENDOR/deliver': { DISPATCHED: S.DELIVERED },
  'VENDOR/reject': { PENDING: S.REJECTED },
  'VENDOR/cancel': { CONFIRMED: S.CANCELLED },
  'CUSTOMER/cancel': { PENDING: S.CANCELLED },
  'ADMIN/cancel': { PENDING: S.CANCELLED, CONFIRMED: S.CANCELLED, DISPATCHED: S.CANCELLED },
  'MARKETPLACE/expire': { PENDING: S.CANCELLED },
};

describe('order-status', () => {
  describe('TRANSITIONS', () => {
    for (const actor of Object.values(OrderActorType)) {
      for (const action of ACTIONS) {
        for (const from of ALL_STATUSES) {
          const expected = EXPECTED[`${actor}/${action}`]?.[from];
          it(`${actor} ${action} from ${from} → ${expected ?? 'refused'}`, () => {
            const t = TRANSITIONS[actor][action];
            const allowed = t !== undefined && t.from.includes(from);
            expect(allowed ? t.to : undefined).toBe(expected);
          });
        }
      }
    }

    it('requires a reason exactly where the spec says', () => {
      expect(TRANSITIONS.VENDOR.reject?.reason).toBe('required');
      expect(TRANSITIONS.VENDOR.cancel?.reason).toBe('required');
      expect(TRANSITIONS.ADMIN.cancel?.reason).toBe('required');
      expect(TRANSITIONS.MARKETPLACE.expire?.reason).toBe('required');
      expect(TRANSITIONS.CUSTOMER.cancel?.reason).toBe('optional');
      expect(TRANSITIONS.VENDOR.confirm?.reason).toBe('none');
      expect(TRANSITIONS.VENDOR.dispatch?.reason).toBe('none');
      expect(TRANSITIONS.VENDOR.deliver?.reason).toBe('none');
    });
  });

  describe('returnsStock', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected =
          (from === S.PENDING || from === S.CONFIRMED) && (to === S.REJECTED || to === S.CANCELLED);
        it(`${from} → ${to}: ${expected}`, () => expect(returnsStock(from, to)).toBe(expected));
      }
    }
  });

  describe('overallStatus', () => {
    it.each<[SubOrderStatus[], string]>([
      [[S.PENDING], 'OPEN'],
      [[S.CONFIRMED, S.DELIVERED], 'OPEN'],
      [[S.DISPATCHED, S.CANCELLED], 'OPEN'],
      [[S.DELIVERED], 'COMPLETED'],
      [[S.DELIVERED, S.REJECTED, S.CANCELLED], 'COMPLETED'],
      [[S.REJECTED], 'CANCELLED'],
      [[S.CANCELLED, S.REJECTED], 'CANCELLED'],
    ])('%j → %s', (statuses, expected) => expect(overallStatus(statuses)).toBe(expected));

    it('agrees with every combination of two statuses', () => {
      for (const a of ALL_STATUSES) {
        for (const b of ALL_STATUSES) {
          const open = [a, b].some((s) => ['PENDING', 'CONFIRMED', 'DISPATCHED'].includes(s));
          const delivered = [a, b].includes(S.DELIVERED);
          const expected = open ? 'OPEN' : delivered ? 'COMPLETED' : 'CANCELLED';
          expect(overallStatus([a, b])).toBe(expected);
        }
      }
    });
  });

  describe('overallStatusWhere', () => {
    const open = { in: [S.PENDING, S.CONFIRMED, S.DISPATCHED] };
    it('OPEN = some open sub-order', () => {
      expect(overallStatusWhere('OPEN')).toEqual({ subOrders: { some: { status: open } } });
    });
    it('COMPLETED = none open and some delivered', () => {
      expect(overallStatusWhere('COMPLETED')).toEqual({
        AND: [
          { subOrders: { none: { status: open } } },
          { subOrders: { some: { status: S.DELIVERED } } },
        ],
      });
    });
    it('CANCELLED = none open and none delivered', () => {
      expect(overallStatusWhere('CANCELLED')).toEqual({
        AND: [
          { subOrders: { none: { status: open } } },
          { subOrders: { none: { status: S.DELIVERED } } },
        ],
      });
    });
  });

  describe('orderNumber', () => {
    it.each([
      [1, 'ORD-00000001'],
      [12345678, 'ORD-12345678'],
      [123456789, 'ORD-123456789'],
    ])('%d → %s', (seq, expected) => expect(orderNumber(seq)).toBe(expected));
  });
});
