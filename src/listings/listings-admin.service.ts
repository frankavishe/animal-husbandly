import { Injectable, NotFoundException } from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { StorageService } from '../common/storage';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListingDto, AdminListListingsQueryDto } from './dto';
import { listingInclude, toAdminListing } from './listing.mapper';
import { cannot, LISTING_NOT_FOUND } from './listings.service';

/** Statuses an admin may take a listing down from (FR-020). */
const TAKE_DOWN_FROM: ListingStatus[] = [
  ListingStatus.DRAFT,
  ListingStatus.ACTIVE,
  ListingStatus.INACTIVE,
];

@Injectable()
export class ListingsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(q: AdminListListingsQueryDto): Promise<Paginated<AdminListingDto>> {
    const where = ListingsAdminService.listWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(q),
      }),
      this.prisma.listing.count({ where }),
    ]);
    return paginate(
      rows.map((l) => toAdminListing(l, this.storage)),
      total,
      q,
    );
  }

  static listWhere(q: Partial<AdminListListingsQueryDto>): Prisma.ListingWhereInput {
    const where: Prisma.ListingWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.vendorId) where.vendorId = q.vendorId;
    if (q.species) where.species = q.species;
    if (q.listingType) where.listingType = q.listingType;
    return where;
  }

  async get(id: string): Promise<AdminListingDto> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: listingInclude,
    });
    if (!listing) throw new NotFoundException(LISTING_NOT_FOUND);
    return toAdminListing(listing, this.storage);
  }

  takeDown(adminId: string, id: string, reason: string): Promise<AdminListingDto> {
    return this.transition(id, 'take down', TAKE_DOWN_FROM, {
      status: ListingStatus.TAKEN_DOWN,
      takenDownReason: reason,
      takenDownById: adminId,
      takenDownAt: new Date(),
    });
  }

  /** Clears only the reason; who/when of the last take-down stay for admins (R9). */
  restore(id: string): Promise<AdminListingDto> {
    return this.transition(id, 'restore', [ListingStatus.TAKEN_DOWN], {
      status: ListingStatus.INACTIVE,
      takenDownReason: null,
    });
  }

  /** Race-safe conditional update (R4): one winner, everyone else gets 409 naming the status. */
  private async transition(
    id: string,
    action: string,
    from: ListingStatus[],
    data: Prisma.ListingUncheckedUpdateManyInput,
  ): Promise<AdminListingDto> {
    const { count } = await this.prisma.listing.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    const listing = await this.get(id);
    if (count === 0) throw cannot(action, listing.status);
    return listing;
  }
}
