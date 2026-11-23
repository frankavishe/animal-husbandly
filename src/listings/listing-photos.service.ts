import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StorageService } from '../common/storage';
import { detectImageType } from '../common/utils/image';
import { PrismaService } from '../prisma/prisma.service';
import { UploadedImage, VendorsService } from '../vendors/vendors.service';
import { OwnerListingDto } from './dto';
import { listingInclude, ListingWithRelations, toOwnerListing } from './listing.mapper';
import { assertShopApproved, LISTING_NOT_FOUND } from './listings.service';

export const MAX_PHOTOS = 5;
export const PHOTO_NOT_FOUND = 'Photo not found';
export const TOO_MANY_PHOTOS = `A listing can have at most ${MAX_PHOTOS} photos`;
export const BAD_PHOTO_ORDER = 'photoIds must list every photo of the listing exactly once';

@Injectable()
export class ListingPhotosService {
  private readonly logger = new Logger(ListingPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: VendorsService,
    private readonly storage: StorageService,
  ) {}

  /** FR: up to 5 verified images; the object is uploaded first, the row is added under a listing lock. */
  async add(
    userId: string,
    listingId: string,
    file: UploadedImage | undefined,
  ): Promise<OwnerListingDto> {
    if (!file?.buffer?.length) throw new BadRequestException('A photo file is required');
    const listing = await this.loadEditable(userId, listingId);
    if (listing.photos.length >= MAX_PHOTOS) throw new ConflictException(TOO_MANY_PHOTOS);
    const type = detectImageType(file.buffer);
    if (!type) throw new BadRequestException('Photo must be a JPEG, PNG or WebP image');

    const key = `listings/${listing.id}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, listing.id);
        const count = await tx.listingPhoto.count({ where: { listingId: listing.id } });
        if (count >= MAX_PHOTOS) throw new ConflictException(TOO_MANY_PHOTOS);
        await tx.listingPhoto.create({ data: { listingId: listing.id, key, position: count } });
      });
    } catch (e) {
      await this.deleteQuietly(key);
      throw e;
    }
    return this.reload(listing.id);
  }

  async remove(userId: string, listingId: string, photoId: string): Promise<OwnerListingDto> {
    const listing = await this.loadEditable(userId, listingId);
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, listing.id);
      const photo = await tx.listingPhoto.findFirst({
        where: { id: photoId, listingId: listing.id },
      });
      if (!photo) throw new NotFoundException(PHOTO_NOT_FOUND);
      await tx.listingPhoto.delete({ where: { id: photo.id } });
      await tx.listingPhoto.updateMany({
        where: { listingId: listing.id, position: { gt: photo.position } },
        data: { position: { decrement: 1 } },
      });
      return photo;
    });
    await this.deleteQuietly(removed.key);
    return this.reload(listing.id);
  }

  async reorder(userId: string, listingId: string, photoIds: string[]): Promise<OwnerListingDto> {
    const listing = await this.loadEditable(userId, listingId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, listing.id);
      const current = await tx.listingPhoto.findMany({
        where: { listingId: listing.id },
        select: { id: true },
      });
      const currentIds = new Set(current.map((p) => p.id));
      const valid =
        photoIds.length === currentIds.size &&
        new Set(photoIds).size === photoIds.length &&
        photoIds.every((id) => currentIds.has(id));
      if (!valid) throw new BadRequestException(BAD_PHOTO_ORDER);
      for (const [index, id] of photoIds.entries()) {
        await tx.listingPhoto.update({ where: { id }, data: { position: index } });
      }
    });
    return this.reload(listing.id);
  }

  // ---------------------------------------------------------------- helpers

  /** Own listing (else 404), approved shop (else 403), not ARCHIVED (else 409). */
  private async loadEditable(userId: string, listingId: string): Promise<ListingWithRelations> {
    const vendor = await this.vendors.findMine(userId);
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, vendorId: vendor.id },
      include: listingInclude,
    });
    if (!listing) throw new NotFoundException(LISTING_NOT_FOUND);
    assertShopApproved(vendor);
    if (listing.status === ListingStatus.ARCHIVED) {
      throw new ConflictException(
        `Cannot change photos of a listing that is ${ListingStatus.ARCHIVED}`,
      );
    }
    return listing;
  }

  /** Row lock on the listing: serialises concurrent photo changes (count/positions). */
  private async lock(tx: Prisma.TransactionClient, listingId: string): Promise<void> {
    await tx.listing.update({ where: { id: listingId }, data: { updatedAt: new Date() } });
  }

  private async reload(listingId: string): Promise<OwnerListingDto> {
    const listing = await this.prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: listingInclude,
    });
    return toOwnerListing(listing, this.storage);
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (e) {
      this.logger.warn(`Failed to delete photo object ${key}: ${(e as Error).message}`);
    }
  }
}
