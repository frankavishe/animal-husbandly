import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderActorType, Prisma, SubOrderStatus } from '@prisma/client';
import { ListingStockService } from '../listings/listing-stock.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ORDER_NOT_FOUND,
  ORDER_TX_OPTIONS,
  returnsStock,
  TRANSITIONS,
  TransitionAction,
} from './order-status';

export interface TransitionRequest {
  subOrderId: string;
  /** Ownership scope, e.g. `{ vendorId }` or `{ order: { customerId } }`; no match → 404. */
  where?: Prisma.SubOrderWhereInput;
  actorType: OrderActorType;
  /** The acting user; must be null exactly for MARKETPLACE. */
  actorId: string | null;
  action: TransitionAction;
  reason?: string | null;
}

export interface TransitionResult {
  from: SubOrderStatus;
  to: SubOrderStatus;
  stockReturned: boolean;
}

export function cannotTransition(action: string, status: SubOrderStatus): ConflictException {
  return new ConflictException(`Cannot ${action} an order that is ${status}`);
}

/**
 * The single place sub-order statuses change (R9, FR-028–030): row lock, allowed-from check,
 * update, history entry and stock return, all in one transaction.
 */
@Injectable()
export class SubOrderTransitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: ListingStockService,
  ) {}

  apply(req: TransitionRequest): Promise<TransitionResult> {
    const transition = TRANSITIONS[req.actorType][req.action];
    if (!transition) {
      throw new Error(`No ${req.action} transition for ${req.actorType}`);
    }
    if ((req.actorType === OrderActorType.MARKETPLACE) !== (req.actorId === null)) {
      throw new Error('actorId must be null exactly for MARKETPLACE');
    }
    const reason = transition.reason === 'none' ? null : req.reason?.trim() || null;
    if (transition.reason === 'required' && !reason) {
      throw new Error(`${req.action} by ${req.actorType} requires a reason`);
    }

    return this.prisma.$transaction(async (tx) => {
      const scoped = await tx.subOrder.findFirst({
        where: { ...req.where, id: req.subOrderId },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException(ORDER_NOT_FOUND);

      // Lock and read the current status; the ownership scope never changes.
      const [locked] = await tx.$queryRaw<{ status: SubOrderStatus }[]>`
        SELECT status FROM sub_orders WHERE id = ${req.subOrderId}::uuid FOR UPDATE`;
      const from = locked.status;
      if (!transition.from.includes(from)) throw cannotTransition(req.action, from);

      const to = transition.to;
      await tx.subOrder.update({
        where: { id: req.subOrderId },
        data: {
          status: to,
          ...(to === SubOrderStatus.DELIVERED ? { cashCollectedAt: new Date() } : {}),
        },
      });
      await tx.subOrderStatusHistory.create({
        data: {
          subOrderId: req.subOrderId,
          fromStatus: from,
          toStatus: to,
          actorType: req.actorType,
          actorId: req.actorId,
          reason,
        },
      });

      const stockReturned = returnsStock(from, to);
      if (stockReturned) {
        const items = await tx.orderItem.findMany({
          where: { subOrderId: req.subOrderId },
          select: { listingId: true, quantity: true },
        });
        await this.stock.giveBack(tx, items);
      }
      return { from, to, stockReturned };
    }, ORDER_TX_OPTIONS);
  }
}
