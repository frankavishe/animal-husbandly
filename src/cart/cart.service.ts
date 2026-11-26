import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { ORDER_TX_OPTIONS } from '../orders/order-status';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_VENDOR_WHERE } from '../vendors/vendors.service';
import { cartItemInclude, EMPTY_CART, toCart } from './cart.mapper';
import { AddCartItemDto, CartDto, SetCartItemDto } from './dto';

export const MAX_CART_LINES = 50;
export const LISTING_NOT_FOUND = 'Listing not found';
export const NOT_IN_CART = 'Listing is not in your cart';
export const OWN_SHOP = 'You cannot buy from your own shop';

/** A cart line as checkout sees it. */
export interface CartLine {
  listingId: string;
  quantity: number;
  lastSeenPrice: number;
  title: string;
}

type Tx = Prisma.TransactionClient;

/**
 * One private cart per CUSTOMER or VENDOR (FR-001–007). Every write locks the cart row first (R2),
 * so simultaneous adds combine and the 50-line limit holds. Carts never touch stock (FR-005).
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    if (!cart) return EMPTY_CART;
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: cartItemInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return toCart(items);
  }

  add(userId: string, dto: AddCartItemDto): Promise<CartDto> {
    return this.write(userId, async (tx, cartId) => {
      const listing = await this.visibleListing(tx, userId, dto.listingId);
      const existing = await tx.cartItem.findUnique({
        where: { cartId_listingId: { cartId, listingId: dto.listingId } },
        select: { quantity: true },
      });
      if (listing.stockQuantity === 0) throw outOfStock(listing.title);
      const quantity = (existing?.quantity ?? 0) + dto.quantity;
      if (quantity > listing.stockQuantity) {
        throw new ConflictException(
          `Only ${listing.stockQuantity} of "${listing.title}" in stock` +
            (existing ? ` (you already have ${existing.quantity} in your cart)` : ''),
        );
      }
      if (!existing) {
        const lines = await tx.cartItem.count({ where: { cartId } });
        if (lines >= MAX_CART_LINES) {
          throw new ConflictException(
            `Your cart can hold at most ${MAX_CART_LINES} different listings`,
          );
        }
      }
      await tx.cartItem.upsert({
        where: { cartId_listingId: { cartId, listingId: dto.listingId } },
        create: { cartId, listingId: dto.listingId, quantity, lastSeenPrice: listing.unitPrice },
        update: { quantity, lastSeenPrice: listing.unitPrice },
      });
    });
  }

  set(userId: string, listingId: string, dto: SetCartItemDto): Promise<CartDto> {
    return this.write(userId, async (tx, cartId) => {
      const existing = await tx.cartItem.findUnique({
        where: { cartId_listingId: { cartId, listingId } },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException(NOT_IN_CART);
      const listing = await this.visibleListing(tx, userId, listingId);
      if (listing.stockQuantity === 0) throw outOfStock(listing.title);
      if (dto.quantity > listing.stockQuantity) {
        throw new ConflictException(`Only ${listing.stockQuantity} of "${listing.title}" in stock`);
      }
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity: dto.quantity, lastSeenPrice: listing.unitPrice },
      });
    });
  }

  /** Works on unavailable lines too. */
  remove(userId: string, listingId: string): Promise<CartDto> {
    return this.write(userId, async (tx, cartId) => {
      const { count } = await tx.cartItem.deleteMany({ where: { cartId, listingId } });
      if (count === 0) throw new NotFoundException(NOT_IN_CART);
    });
  }

  clear(userId: string): Promise<CartDto> {
    return this.write(userId, (tx, cartId) => this.empty(tx, cartId));
  }

  // ---------------------------------------------------------------- for checkout (R12)

  /** Creates the user's cart if needed and locks it `FOR UPDATE` in the caller's transaction. */
  async lockForCheckout(tx: Tx, userId: string): Promise<string> {
    await tx.$executeRaw`
      INSERT INTO carts (id, user_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, now(), now())
      ON CONFLICT (user_id) DO NOTHING`;
    const [cart] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM carts WHERE user_id = ${userId}::uuid FOR UPDATE`;
    return cart.id;
  }

  async loadLines(tx: Tx, cartId: string): Promise<CartLine[]> {
    const items = await tx.cartItem.findMany({
      where: { cartId },
      select: {
        listingId: true,
        quantity: true,
        lastSeenPrice: true,
        listing: { select: { title: true } },
      },
      orderBy: { listingId: 'asc' },
    });
    return items.map(({ listing, ...i }) => ({ ...i, title: listing.title }));
  }

  async empty(tx: Tx, cartId: string): Promise<void> {
    await tx.cartItem.deleteMany({ where: { cartId } });
  }

  // ---------------------------------------------------------------- helpers

  private async write(
    userId: string,
    fn: (tx: Tx, cartId: string) => Promise<unknown>,
  ): Promise<CartDto> {
    await this.prisma.$transaction(async (tx) => {
      const cartId = await this.lockForCheckout(tx, userId);
      await fn(tx, cartId);
      await tx.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
    }, ORDER_TX_OPTIONS);
    return this.get(userId);
  }

  /** The listing if publicly visible (else 404) and not the caller's own (else 403). */
  private async visibleListing(tx: Tx, userId: string, listingId: string) {
    const listing = await tx.listing.findFirst({
      where: { id: listingId, status: ListingStatus.ACTIVE, vendor: PUBLIC_VENDOR_WHERE },
      select: {
        title: true,
        unitPrice: true,
        stockQuantity: true,
        vendor: { select: { userId: true } },
      },
    });
    if (!listing) throw new NotFoundException(LISTING_NOT_FOUND);
    if (listing.vendor.userId === userId) throw new ForbiddenException(OWN_SHOP);
    return listing;
  }
}

function outOfStock(title: string): ConflictException {
  return new ConflictException(`"${title}" is out of stock`);
}
