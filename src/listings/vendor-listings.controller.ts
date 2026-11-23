import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { createImageUploadInterceptor } from '../common/upload/image-upload.interceptor';
import { UploadedImage } from '../vendors/vendors.service';
import {
  CreateListingDto,
  OwnerListingDto,
  PaginatedOwnerListingsDto,
  ReorderPhotosDto,
  UpdateListingDto,
  VendorListListingsQueryDto,
} from './dto';
import { ListingPhotosService } from './listing-photos.service';
import { ListingsService } from './listings.service';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PhotoUploadInterceptor = createImageUploadInterceptor(MAX_PHOTO_BYTES, 'Photo');

@ApiTags('listings')
@ApiBearerAuth()
@Roles(Role.VENDOR)
@Controller('vendors/me/listings')
export class VendorListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly photos: ListingPhotosService,
  ) {}

  // ---------------------------------------------------------------- details (US1)

  @Post()
  @ApiOperation({ summary: 'Create a listing (starts DRAFT; shop must be APPROVED)' })
  @ApiCreatedResponse({ type: OwnerListingDto })
  @ApiBadRequestResponse({
    description: 'Validation error, disallowed species/type/unit, or species not in the shop',
  })
  @ApiForbiddenResponse({ description: 'Shop is not approved or is suspended' })
  @ApiNotFoundResponse({ description: 'You do not have a shop' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto): Promise<OwnerListingDto> {
    return this.listings.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'My listings, newest first (ARCHIVED only when status=ARCHIVED is requested)',
  })
  @ApiOkResponse({ type: PaginatedOwnerListingsDto })
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() q: VendorListListingsQueryDto,
  ): Promise<PaginatedOwnerListingsDto> {
    return this.listings.listMine(user.id, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my listings (any status, incl. take-down reason)' })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  getMine(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnerListingDto> {
    return this.listings.getMine(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a listing (not ARCHIVED; species/type only while DRAFT; null clears animal fields)',
  })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiBadRequestResponse({ description: 'The edited listing breaks a rule' })
  @ApiForbiddenResponse({ description: 'Shop is not approved or is suspended' })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  @ApiConflictResponse({ description: 'ARCHIVED, or species/type change outside DRAFT' })
  updateMine(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ): Promise<OwnerListingDto> {
    return this.listings.updateMine(user.id, id, dto);
  }

  // ---------------------------------------------------------------- lifecycle (US2)

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a DRAFT listing (→ ACTIVE; shop must be APPROVED)' })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiForbiddenResponse({ description: 'Shop is not approved or is suspended' })
  @ApiConflictResponse({ description: 'Listing is not DRAFT' })
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnerListingDto> {
    return this.listings.publish(user.id, id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause an ACTIVE listing (→ INACTIVE)' })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiConflictResponse({ description: 'Listing is not ACTIVE' })
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnerListingDto> {
    return this.listings.pause(user.id, id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-activate an INACTIVE listing (→ ACTIVE; shop must be APPROVED)' })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiForbiddenResponse({ description: 'Shop is not approved or is suspended' })
  @ApiConflictResponse({ description: 'Listing is not INACTIVE' })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnerListingDto> {
    return this.listings.activate(user.id, id);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a listing for good (photos are kept)' })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiConflictResponse({ description: 'Listing is already ARCHIVED' })
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnerListingDto> {
    return this.listings.archive(user.id, id);
  }

  // ---------------------------------------------------------------- photos (US4)

  @Post(':id/photos')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(PhotoUploadInterceptor)
  @ApiOperation({
    summary: 'Add a photo (JPEG, PNG or WebP, max 5 MB; up to 5 per listing, appended last)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: OwnerListingDto })
  @ApiBadRequestResponse({ description: 'Missing file or not a JPEG/PNG/WebP image' })
  @ApiForbiddenResponse({ description: 'Shop is not approved or is suspended' })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  @ApiConflictResponse({ description: 'Listing is ARCHIVED or already has 5 photos' })
  @ApiPayloadTooLargeResponse({ description: 'File larger than 5 MB' })
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<OwnerListingDto> {
    return this.photos.add(user.id, id, file);
  }

  @Delete(':id/photos/:photoId')
  @ApiOperation({ summary: 'Remove a photo (later photos move up one position)' })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiForbiddenResponse({ description: 'Shop is not approved or is suspended' })
  @ApiNotFoundResponse({ description: 'Listing or photo not found' })
  @ApiConflictResponse({ description: 'Listing is ARCHIVED' })
  removePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<OwnerListingDto> {
    return this.photos.remove(user.id, id, photoId);
  }

  @Put(':id/photos/order')
  @ApiOperation({ summary: 'Reorder photos (list every photo id once; first becomes the cover)' })
  @ApiOkResponse({ type: OwnerListingDto })
  @ApiBadRequestResponse({ description: 'photoIds is not exactly the set of current photos' })
  @ApiForbiddenResponse({ description: 'Shop is not approved or is suspended' })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  @ApiConflictResponse({ description: 'Listing is ARCHIVED' })
  reorderPhotos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderPhotosDto,
  ): Promise<OwnerListingDto> {
    return this.photos.reorder(user.id, id, dto.photoIds);
  }
}
