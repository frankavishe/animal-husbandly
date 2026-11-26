import { ListingStatus, Prisma, VendorStatus } from '@prisma/client';
import { MAX_ORDER_TOTAL } from '../orders/order-status';
import { CartDto, CartFlag, CartLineDto, CartShopDto } from './dto';

/** What the cart view needs about each line's listing and shop. */
export const cartItemInclude = {
  listing: {
    select: {
      id: true,
      title: true,
      unit: true,
      unitPrice: true,
      stockQuantity: true,
      status: true,
      vendor: {
        select: {
          id: true,
          slug: true,
          shopName: true,
          status: true,
          user: { select: { isActive: true } },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

export type CartItemWithListing = Prisma.CartItemGetPayload<{ include: typeof cartItemInclude }>;

/** The public visibility rule (ACTIVE, shop APPROVED, owner active), applied in memory. */
export function isAvailable(listing: CartItemWithListing['listing']): boolean {
  return (
    listing.status === ListingStatus.ACTIVE &&
    listing.vendor.status === VendorStatus.APPROVED &&
    listing.vendor.user.isActive
  );
}

export const EMPTY_CART: CartDto = { shops: [], total: 0, lineCount: 0, exceedsMaxTotal: false };

/**
 * Groups lines by shop (in the order shops first appear) and flags them (FR-006/007). Sums are
 * `bigint`; the maximum is compared on the `bigint`, never on the converted number (R1).
 * Unavailable lines expose no price, stock or reason.
 */
export function toCart(items: CartItemWithListing[]): CartDto {
  const shops = new Map<string, { dto: CartShopDto; subtotal: bigint }>();
  let total = 0n;

  for (const item of items) {
    const { listing } = item;
    const available = isAvailable(listing);
    const flags: CartFlag[] = [];
    let line: CartLineDto;
    let lineTotal = 0n;

    if (!available) {
      flags.push(CartFlag.UNAVAILABLE);
      line = {
        listingId: listing.id,
        title: listing.title,
        unit: listing.unit,
        quantity: item.quantity,
        unitPrice: null,
        lineTotal: null,
        stockLeft: null,
        previousPrice: null,
        flags,
      };
    } else {
      if (listing.stockQuantity < item.quantity) flags.push(CartFlag.SHORT_OF_STOCK);
      const priceChanged = listing.unitPrice !== item.lastSeenPrice;
      if (priceChanged) flags.push(CartFlag.PRICE_CHANGED);
      lineTotal = BigInt(listing.unitPrice) * BigInt(item.quantity);
      line = {
        listingId: listing.id,
        title: listing.title,
        unit: listing.unit,
        quantity: item.quantity,
        unitPrice: listing.unitPrice,
        lineTotal: Number(lineTotal),
        stockLeft: listing.stockQuantity,
        previousPrice: priceChanged ? item.lastSeenPrice : null,
        flags,
      };
      total += lineTotal;
    }

    const vendor = listing.vendor;
    let shop = shops.get(vendor.id);
    if (!shop) {
      shop = {
        dto: { shop: { slug: vendor.slug, shopName: vendor.shopName }, lines: [], subtotal: 0 },
        subtotal: 0n,
      };
      shops.set(vendor.id, shop);
    }
    shop.dto.lines.push(line);
    shop.subtotal += lineTotal;
  }

  return {
    shops: [...shops.values()].map(({ dto, subtotal }) => ({ ...dto, subtotal: Number(subtotal) })),
    total: Number(total),
    lineCount: items.length,
    exceedsMaxTotal: total > MAX_ORDER_TOTAL,
  };
}
