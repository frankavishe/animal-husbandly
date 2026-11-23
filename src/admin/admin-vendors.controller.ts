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
  AdminListVendorsQueryDto,
  AdminVendorDto,
  PaginatedAdminVendorsDto,
  RejectVendorDto,
} from '../vendors/dto';
import { VendorsAdminService } from '../vendors/vendors-admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/vendors')
export class AdminVendorsController {
  constructor(private readonly vendors: VendorsAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List shops (filter by status, search by name; newest submission first)',
  })
  @ApiOkResponse({ type: PaginatedAdminVendorsDto })
  list(@Query() q: AdminListVendorsQueryDto): Promise<PaginatedAdminVendorsDto> {
    return this.vendors.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Shop detail incl. owner, payout account and review info' })
  @ApiOkResponse({ type: AdminVendorDto })
  @ApiNotFoundResponse({ description: 'Shop not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminVendorDto> {
    return this.vendors.get(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a PENDING shop; the owner becomes a VENDOR' })
  @ApiOkResponse({ type: AdminVendorDto })
  @ApiConflictResponse({ description: 'Shop is not PENDING, or owner is deactivated' })
  approve(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVendorDto> {
    return this.vendors.approve(admin.id, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a PENDING shop with a reason' })
  @ApiOkResponse({ type: AdminVendorDto })
  @ApiConflictResponse({ description: 'Shop is not PENDING' })
  reject(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectVendorDto,
  ): Promise<AdminVendorDto> {
    return this.vendors.reject(admin.id, id, dto.reason);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an APPROVED shop (hidden from the public)' })
  @ApiOkResponse({ type: AdminVendorDto })
  @ApiConflictResponse({ description: 'Shop is not APPROVED' })
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVendorDto> {
    return this.vendors.suspend(admin.id, id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a SUSPENDED shop' })
  @ApiOkResponse({ type: AdminVendorDto })
  @ApiConflictResponse({ description: 'Shop is not SUSPENDED' })
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVendorDto> {
    return this.vendors.reactivate(admin.id, id);
  }
}
