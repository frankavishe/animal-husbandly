import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import {
  AdminListingDto,
  AdminListListingsQueryDto,
  PaginatedAdminListingsDto,
  TakeDownListingDto,
} from '../listings/dto';
import { ListingsAdminService } from '../listings/listings-admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/listings')
export class AdminListingsController {
  constructor(private readonly listings: ListingsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List listings of any status (newest first)' })
  @ApiOkResponse({ type: PaginatedAdminListingsDto })
  list(@Query() q: AdminListListingsQueryDto): Promise<PaginatedAdminListingsDto> {
    return this.listings.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Listing detail incl. status, shop and take-down info' })
  @ApiOkResponse({ type: AdminListingDto })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminListingDto> {
    return this.listings.get(id);
  }

  @Post(':id/take-down')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take down a DRAFT, ACTIVE or INACTIVE listing with a reason' })
  @ApiOkResponse({ type: AdminListingDto })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  @ApiConflictResponse({ description: 'Listing is ARCHIVED or already TAKEN_DOWN' })
  takeDown(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TakeDownListingDto,
  ): Promise<AdminListingDto> {
    return this.listings.takeDown(admin.id, id, dto.reason);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a TAKEN_DOWN listing to INACTIVE' })
  @ApiOkResponse({ type: AdminListingDto })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  @ApiConflictResponse({ description: 'Listing is not TAKEN_DOWN' })
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<AdminListingDto> {
    return this.listings.restore(id);
  }
}
