import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { PaginatedPublicListingsDto, PublicListingDto, PublicListListingsQueryDto } from './dto';
import { ListingsService } from './listings.service';

@ApiTags('listings')
@Public()
@Controller('listings')
export class PublicListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Browse listings for sale (no sign-in needed; filters, search and sorting)',
  })
  @ApiOkResponse({ type: PaginatedPublicListingsDto })
  @ApiBadRequestResponse({ description: 'Invalid filter, or minPrice greater than maxPrice' })
  list(@Query() q: PublicListListingsQueryDto): Promise<PaginatedPublicListingsDto> {
    return this.listings.listPublic(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One listing that is for sale' })
  @ApiOkResponse({ type: PublicListingDto })
  @ApiNotFoundResponse({ description: 'Listing not found or not visible' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PublicListingDto> {
    return this.listings.getPublic(id);
  }
}
