import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { OrderActorType, Prisma, SubOrderStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CartLine, CartService } from '../cart/cart.service';
import { ListingStockService, LockedListing } from '../listings/listing-stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesService } from '../users/addresses.service';
import { CheckoutDto, CheckoutLineDto, CustomerOrderDto } from './dto';
import { orderInclude, toCustomerOrder } from './order.mapper';
import {
  MAX_OPEN_ORDERS,
  MAX_ORDER_TOTAL,
  ORDER_TX_OPTIONS,
  OverallStatus,
  overallStatusWhere,
} from './order-status';

export const KEY_REUSED = 'This submission key was already used with a different address or lines';
export const EMPTY_CART = 'Your cart is empty';
export const TOO_MANY_OPEN = `You already have ${MAX_OPEN_ORDERS} open orders; wait until one is completed or cancelled`;
export const ABOVE_MAX_TOTAL = 'The order total is above the maximum of 10000000000 TZS';

/** SHA-256 of the address id and the lines sorted by listing id (R5); line order does not matter. */
export function submissionHash(dto: Pick<CheckoutDto, 'addressId' | 'lines'>): string {
  const lines = [...dto.lines]
    .sort((a, b) => (a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0))
    .map((l) => [l.listingId, l.quantity, l.unitPrice]);
  return createHash('sha256')
    .update(JSON.stringify({ addressId: dto.addressId, lines }))
    .digest('hex');
}

/**
 * Every problem between the cart, what the buyer confirmed and the locked listings (R6, FR-010/011),
 * one message per problem in the contract's wording. Empty when checkout may proceed.
 */
export function findProblems(
  userId: string,
  cart: CartLine[],
  confirmed: CheckoutLineDto[],
  locked: LockedListing[],
): string[] {
  const problems: string[] = [];
  const byId = new Map(locked.map((l) => [l.id, l]));
  const confirmedById = new Map(confirmed.map((l) => [l.listingId, l]));

  for (const line of cart) {
    const name = `"${line.title}" (${line.listingId})`;
    const c = confirmedById.get(line.listingId);
    const listing = byId.get(line.listingId);
    if (!c) {
      problems.push(`${name} is in your cart but was not confirmed`);
      continue;
    }
    if (!listing || !listing.available) {
      problems.push(`${name} is no longer available`);
      continue;
    }
    if (listing.vendor.userId === userId) {
      problems.push(`${name}: you cannot buy from your own shop`);
      continue;
    }
    if (c.quantity !== line.quantity) {
      problems.push(
        `${name}: quantity in your cart is ${line.quantity} (you confirmed ${c.quantity})`,
      );
    }
    if (c.unitPrice !== listing.unitPrice) {
      problems.push(`${name}: price is now ${listing.unitPrice} (you confirmed ${c.unitPrice})`);
    }
    if (listing.stockQuantity < c.quantity) {
      problems.push(`${name}: only ${listing.stockQuantity} left (you asked for ${c.quantity})`);
    }
  }

  const inCart = new Set(cart.map((l) => l.listingId));
  for (const c of [...confirmed].sort((a, b) => (a.listingId < b.listingId ? -1 : 1))) {
    if (!inCart.has(c.listingId)) problems.push(`Listing ${c.listingId} is not in your cart`);
  }
  return problems;
}

interface ShopGroup {
  vendorId: string;
  shopName: string;
  subtotal: bigint;
  items: Prisma.OrderItemCreateWithoutSubOrderInput[];
}

/** Splits the confirmed lines per shop (FR-014) with exact bigint sums (FR-016). */
export function groupByShop(
  confirmed: CheckoutLineDto[],
  locked: LockedListing[],
): { groups: ShopGroup[]; total: bigint } {
  const byId = new Map(locked.map((l) => [l.id, l]));
  const groups = new Map<string, ShopGroup>();
  let total = 0n;
  for (const c of [...confirmed].sort((a, b) => (a.listingId < b.listingId ? -1 : 1))) {
    const listing = byId.get(c.listingId)!;
    const lineTotal = BigInt(c.unitPrice) * BigInt(c.quantity);
    let group = groups.get(listing.vendor.id);
    if (!group) {
      group = {
        vendorId: listing.vendor.id,
        shopName: listing.vendor.shopName,
        subtotal: 0n,
        items: [],
      };
      groups.set(listing.vendor.id, group);
    }
    group.items.push({
      listing: { connect: { id: listing.id } },
      title: listing.title,
      species: listing.species,
      listingType: listing.listingType,
      unit: listing.unit,
      unitPrice: c.unitPrice,
      quantity: c.quantity,
      lineTotal,
    });
    group.subtotal += lineTotal;
    total += lineTotal;
  }
  return { groups: [...groups.values()], total };
}

/**
 * All-or-nothing, idempotent cash-on-delivery checkout (FR-008–016). One transaction, in this
 * order: cart lock, replay lookup, open-order limit, empty cart, address, listing locks, problems,
 * total, stock, order creation, empty the cart.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly stock: ListingStockService,
    private readonly addresses: AddressesService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto): Promise<CustomerOrderDto> {
    const hash = submissionHash(dto);
    const orderId = await this.prisma.$transaction(async (tx) => {
      const cartId = await this.cart.lockForCheckout(tx, userId);

      const prior = await tx.order.findUnique({
        where: {
          customerId_submissionKey: { customerId: userId, submissionKey: dto.submissionKey },
        },
        select: { id: true, submissionHash: true },
      });
      if (prior) {
        if (prior.submissionHash !== hash) throw new ConflictException(KEY_REUSED);
        return prior.id;
      }

      const open = await tx.order.count({
        where: { customerId: userId, ...overallStatusWhere(OverallStatus.OPEN) },
      });
      if (open >= MAX_OPEN_ORDERS) throw new ConflictException(TOO_MANY_OPEN);

      const lines = await this.cart.loadLines(tx, cartId);
      if (lines.length === 0) throw new BadRequestException(EMPTY_CART);

      const address = await this.addresses.get(userId, dto.addressId, tx);

      const locked = await this.stock.lockForSale(
        tx,
        lines.map((l) => l.listingId),
      );
      const problems = findProblems(userId, lines, dto.lines, locked);
      if (problems.length) throw new ConflictException(problems);

      const { groups, total } = groupByShop(dto.lines, locked);
      if (total > MAX_ORDER_TOTAL) throw new ConflictException(ABOVE_MAX_TOTAL);

      for (const l of [...dto.lines].sort((a, b) => (a.listingId < b.listingId ? -1 : 1))) {
        await this.stock.take(tx, l.listingId, l.quantity);
      }

      const now = new Date();
      const order = await tx.order.create({
        data: {
          customerId: userId,
          recipientName: address.recipientName,
          contactPhone: address.contactPhone,
          regionName: address.region.name,
          districtName: address.district.name,
          wardStreet: address.wardStreet,
          landmark: address.landmark,
          total,
          submissionKey: dto.submissionKey,
          submissionHash: hash,
          createdAt: now,
          subOrders: {
            create: groups.map((g) => ({
              vendor: { connect: { id: g.vendorId } },
              shopName: g.shopName,
              subtotal: g.subtotal,
              createdAt: now,
              items: { create: g.items },
              history: {
                create: [
                  {
                    fromStatus: null,
                    toStatus: SubOrderStatus.PENDING,
                    actorType: OrderActorType.CUSTOMER,
                    actor: { connect: { id: userId } },
                    createdAt: now,
                  },
                ],
              },
            })),
          },
        },
        select: { id: true },
      });

      await this.cart.empty(tx, cartId);
      return order.id;
    }, ORDER_TX_OPTIONS);

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: orderInclude,
    });
    return toCustomerOrder(order);
  }
}
