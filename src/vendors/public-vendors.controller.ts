import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { PaginatedPublicVendorsDto, PublicListVendorsQueryDto, PublicVendorDto } from './dto';
import { VendorsService } from './vendors.service';

@ApiTags('vendors')
@Public()
@Controller('vendors')
export class PublicVendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @ApiOperation({ summary: 'Browse approved shops (no sign-in needed)' })
  @ApiOkResponse({ type: PaginatedPublicVendorsDto })
  list(@Query() q: PublicListVendorsQueryDto): Promise<PaginatedPublicVendorsDto> {
    return this.vendors.listPublic(q);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'One approved shop by slug' })
  @ApiOkResponse({ type: PublicVendorDto })
  @ApiNotFoundResponse({ description: 'Shop not found or not visible' })
  getBySlug(@Param('slug') slug: string): Promise<PublicVendorDto> {
    return this.vendors.getPublicBySlug(slug);
  }
}
