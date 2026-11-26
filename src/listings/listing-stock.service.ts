import { ConflictException, Injectable } from '@nestjs/common';
import { ListingStatus, ListingType, ListingUnit, Prisma, Species } from '@prisma/client';
import { PUBLIC_VENDOR_WHERE } from '../vendors/vendors.service';

export const MAX_STOCK = 1_000_000;

/** What checkout needs to know about a listing it has locked. */
export interface LockedListing {
  id: string;
  title: string;
  species: Species;
  listingType: ListingType;
  unit: ListingUnit;
  unitPrice: number;
  stockQuantity: number;
  /** ACTIVE, shop APPROVED and owner active (the public visibility rule). */
  available: boolean;
  vendor: { id: string; userId: string; shopName: string; slug: string };
}

const lockedSelect = {
  id: true,
  title: true,
  species: true,
  listingType: true,
  unit: true,
  unitPrice: true,
  stockQuantity: true,
  vendor: { select: { id: true, userId: true, shopName: true, slug: true } },
} satisfies Prisma.ListingSelect;

/**
 * The only code that changes listing stock on behalf of orders (R3, R9, R12). Every method runs
 * inside the caller's transaction so the stock change commits or rolls back with the order.
 */
@Injectable()
export class ListingStockService {
  /**
   * Locks the listings `FOR NO KEY UPDATE` in id order (no deadlocks, and cart/order item inserts
   * can still take their key-share locks), then re-reads them with their visibility.
   */
  async lockForSale(tx: Prisma.TransactionClient, ids: string[]): Promise<LockedListing[]> {
    if (ids.length === 0) return [];
    const sorted = [...new Set(ids)].sort();
    await tx.$queryRaw`
      SELECT id FROM listings WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    const [rows, visible] = await Promise.all([
      tx.listing.findMany({ where: { id: { in: sorted } }, select: lockedSelect }),
      tx.listing.findMany({
        where: { id: { in: sorted }, status: ListingStatus.ACTIVE, vendor: PUBLIC_VENDOR_WHERE },
        select: { id: true },
      }),
    ]);
    const visibleIds = new Set(visible.map((v) => v.id));
    return rows
      .map((l) => ({ ...l, available: visibleIds.has(l.id) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Takes stock; refuses (409) rather than going below zero (FR-012). */
  async take(tx: Prisma.TransactionClient, listingId: string, quantity: number): Promise<void> {
    const { count } = await tx.listing.updateMany({
      where: { id: listingId, stockQuantity: { gte: quantity } },
      data: { stockQuantity: { decrement: quantity } },
    });
    if (count !== 1) throw new ConflictException('Not enough stock');
  }

  /**
   * Returns stock (FR-029): capped at 1,000,000, listing status untouched, in id order so two
   * returns touching the same listings cannot deadlock.
   */
  async giveBack(
    tx: Prisma.TransactionClient,
    items: { listingId: string; quantity: number }[],
  ): Promise<void> {
    const totals = new Map<string, number>();
    for (const { listingId, quantity } of items) {
      totals.set(listingId, (totals.get(listingId) ?? 0) + quantity);
    }
    for (const id of [...totals.keys()].sort()) {
      await tx.$executeRaw`
        UPDATE listings
        SET stock_quantity = LEAST(stock_quantity + ${totals.get(id)}, ${MAX_STOCK}),
            updated_at = now()
        WHERE id = ${id}::uuid`;
    }
  }
}
