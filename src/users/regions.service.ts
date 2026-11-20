import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { District, Region } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  listRegions(): Promise<Region[]> {
    return this.prisma.region.findMany({ orderBy: { name: 'asc' } });
  }

  async listDistricts(regionId: number): Promise<District[]> {
    const region = await this.prisma.region.findUnique({
      where: { id: regionId },
      select: { id: true },
    });
    if (!region) throw new NotFoundException('Region not found');
    return this.prisma.district.findMany({ where: { regionId }, orderBy: { name: 'asc' } });
  }

  /** Throws 400 unless the district exists and belongs to the region. */
  async assertDistrictInRegion(regionId: number, districtId: number): Promise<void> {
    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
      select: { regionId: true },
    });
    if (!district) throw new BadRequestException('District not found');
    if (district.regionId !== regionId) {
      throw new BadRequestException('District does not belong to the selected region');
    }
  }
}
