import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { DistrictResponseDto, RegionResponseDto } from './dto';
import { RegionsService } from './regions.service';

@ApiTags('regions')
@Public()
@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get()
  @ApiOperation({ summary: 'All Tanzania regions' })
  @ApiOkResponse({ type: [RegionResponseDto] })
  list(): Promise<RegionResponseDto[]> {
    return this.regions.listRegions();
  }

  @Get(':id/districts')
  @ApiOperation({ summary: 'Districts of a region' })
  @ApiOkResponse({ type: [DistrictResponseDto] })
  @ApiNotFoundResponse({ description: 'Unknown region' })
  districts(@Param('id', ParseIntPipe) id: number): Promise<DistrictResponseDto[]> {
    return this.regions.listDistricts(id);
  }
}
