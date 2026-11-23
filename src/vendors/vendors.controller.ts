import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
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
import {
  ApplyVendorDto,
  OwnerVendorDto,
  PayoutAccountDto,
  UpdateVendorDto,
  UpsertPayoutAccountDto,
} from './dto';
import { LogoUploadInterceptor } from './logo-upload.interceptor';
import { PayoutAccountsService } from './payout-accounts.service';
import { UploadedImage, VendorsService } from './vendors.service';

@ApiTags('vendors')
@ApiBearerAuth()
@Roles(Role.CUSTOMER, Role.VENDOR)
@Controller('vendors/me')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly payouts: PayoutAccountsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Apply to open a shop (customers only; starts PENDING)' })
  @ApiCreatedResponse({ type: OwnerVendorDto })
  @ApiBadRequestResponse({ description: 'Validation error, district not in region, bad name' })
  @ApiForbiddenResponse({ description: 'Caller is not a customer' })
  @ApiConflictResponse({ description: 'Caller already has a shop' })
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplyVendorDto): Promise<OwnerVendorDto> {
    return this.vendors.apply(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My shop (any status, with rejection reason and payout account)' })
  @ApiOkResponse({ type: OwnerVendorDto })
  @ApiNotFoundResponse({ description: 'You do not have a shop' })
  getMine(@CurrentUser() user: AuthUser): Promise<OwnerVendorDto> {
    return this.vendors.getMine(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Edit my shop (not while SUSPENDED; slug never changes)' })
  @ApiOkResponse({ type: OwnerVendorDto })
  @ApiForbiddenResponse({ description: 'Shop is suspended' })
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateVendorDto): Promise<OwnerVendorDto> {
    return this.vendors.updateMine(user.id, dto);
  }

  @Post('resubmit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resubmit a REJECTED shop for review (back to PENDING)' })
  @ApiOkResponse({ type: OwnerVendorDto })
  @ApiConflictResponse({ description: 'Shop is not REJECTED' })
  resubmit(@CurrentUser() user: AuthUser): Promise<OwnerVendorDto> {
    return this.vendors.resubmit(user.id);
  }

  @Put('logo')
  @UseInterceptors(LogoUploadInterceptor)
  @ApiOperation({ summary: 'Upload or replace the shop logo (JPEG, PNG or WebP, max 2 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: OwnerVendorDto })
  @ApiBadRequestResponse({ description: 'Missing file or not a JPEG/PNG/WebP image' })
  @ApiPayloadTooLargeResponse({ description: 'File larger than 2 MB' })
  setLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<OwnerVendorDto> {
    return this.vendors.setLogo(user.id, file);
  }

  @Delete('logo')
  @ApiOperation({ summary: 'Remove the shop logo' })
  @ApiOkResponse({ type: OwnerVendorDto })
  removeLogo(@CurrentUser() user: AuthUser): Promise<OwnerVendorDto> {
    return this.vendors.removeLogo(user.id);
  }

  @Get('payout-account')
  @ApiOperation({ summary: 'My payout account (owner only)' })
  @ApiOkResponse({ type: PayoutAccountDto })
  @ApiNotFoundResponse({ description: 'No shop or no payout account set' })
  getPayout(@CurrentUser() user: AuthUser): Promise<PayoutAccountDto> {
    return this.payouts.getMine(user.id);
  }

  @Put('payout-account')
  @ApiOperation({ summary: 'Set or replace my payout account (mobile money or bank)' })
  @ApiOkResponse({ type: PayoutAccountDto })
  @ApiBadRequestResponse({ description: 'Missing fields, or fields of the other method' })
  upsertPayout(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertPayoutAccountDto,
  ): Promise<PayoutAccountDto> {
    return this.payouts.upsertMine(user.id, dto);
  }
}
