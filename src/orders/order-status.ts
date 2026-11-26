import { OrderActorType, Prisma, SubOrderStatus } from '@prisma/client';

const { PENDING, CONFIRMED, DISPATCHED, DELIVERED, REJECTED, CANCELLED } = SubOrderStatus;

/** Overall order status, derived from the sub-orders (R8, FR-023). */
export const OverallStatus = {
  OPEN: 'OPEN',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type OverallStatus = (typeof OverallStatus)[keyof typeof OverallStatus];

export const MAX_ORDER_TOTAL = 10_000_000_000n;
export const MAX_OPEN_ORDERS = 10;
export const RESPONSE_LIMIT_HOURS = 48;
export const EXPIRY_REASON = 'The shop did not respond in time';
/** R4: 50 simultaneous checkouts queue on one row; Prisma's defaults (2 s / 5 s) are too short. */
export const ORDER_TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;
export const ORDER_NOT_FOUND = 'Order not found';

/** Sub-order statuses that keep an order OPEN. */
export const OPEN_STATUSES: SubOrderStatus[] = [PENDING, CONFIRMED, DISPATCHED];

export type TransitionAction = 'confirm' | 'dispatch' | 'deliver' | 'reject' | 'cancel' | 'expire';
export type ReasonRule = 'required' | 'optional' | 'none';

export interface Transition {
  from: SubOrderStatus[];
  to: SubOrderStatus;
  reason: ReasonRule;
}

/** Every allowed status change (data-model "State transitions"). Anything else is a 409. */
export const TRANSITIONS: Record<OrderActorType, Partial<Record<TransitionAction, Transition>>> = {
  VENDOR: {
    confirm: { from: [PENDING], to: CONFIRMED, reason: 'none' },
    dispatch: { from: [CONFIRMED], to: DISPATCHED, reason: 'none' },
    deliver: { from: [DISPATCHED], to: DELIVERED, reason: 'none' },
    reject: { from: [PENDING], to: REJECTED, reason: 'required' },
    cancel: { from: [CONFIRMED], to: CANCELLED, reason: 'required' },
  },
  CUSTOMER: {
    cancel: { from: [PENDING], to: CANCELLED, reason: 'optional' },
  },
  ADMIN: {
    cancel: { from: [PENDING, CONFIRMED, DISPATCHED], to: CANCELLED, reason: 'required' },
  },
  MARKETPLACE: {
    expire: { from: [PENDING], to: CANCELLED, reason: 'required' },
  },
};

/** FR-029: stock comes back only from PENDING/CONFIRMED into REJECTED/CANCELLED. */
export function returnsStock(from: SubOrderStatus, to: SubOrderStatus): boolean {
  return (from === PENDING || from === CONFIRMED) && (to === REJECTED || to === CANCELLED);
}

export function overallStatus(statuses: SubOrderStatus[]): OverallStatus {
  if (statuses.some((s) => OPEN_STATUSES.includes(s))) return OverallStatus.OPEN;
  if (statuses.includes(DELIVERED)) return OverallStatus.COMPLETED;
  return OverallStatus.CANCELLED;
}

/** The same rule as `overallStatus`, as a relation filter for list queries (R8). */
export function overallStatusWhere(status: OverallStatus): Prisma.OrderWhereInput {
  const noneOpen: Prisma.OrderWhereInput = {
    subOrders: { none: { status: { in: OPEN_STATUSES } } },
  };
  switch (status) {
    case OverallStatus.OPEN:
      return { subOrders: { some: { status: { in: OPEN_STATUSES } } } };
    case OverallStatus.COMPLETED:
      return { AND: [noneOpen, { subOrders: { some: { status: DELIVERED } } }] };
    case OverallStatus.CANCELLED:
      return { AND: [noneOpen, { subOrders: { none: { status: DELIVERED } } }] };
  }
}

/** `ORD-` plus at least 8 zero-padded digits (R7). */
export function orderNumber(seq: number): string {
  return `ORD-${String(seq).padStart(8, '0')}`;
}
