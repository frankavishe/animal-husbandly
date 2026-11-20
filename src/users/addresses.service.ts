import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddressResponseDto, CreateAddressDto, UpdateAddressDto } from './dto';
import { RegionsService } from './regions.service';

const include = {
  region: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
} satisfies Prisma.AddressInclude;

type AddressWithRefs = Prisma.AddressGetPayload<{ include: typeof include }>;

function toResponse(a: AddressWithRefs): AddressResponseDto {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    contactPhone: a.contactPhone,
    region: a.region,
    district: a.district,
    wardStreet: a.wardStreet,
    landmark: a.landmark,
    isDefault: a.isDefault,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/**
 * Delivery addresses. Ownership is enforced by always filtering on userId (others' → 404, FR-024).
 * Default rules (FR-023): first address is default; at most one default per user, switched in
 * one transaction; deleting the default promotes the most recently created remaining address.
 */
@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regions: RegionsService,
  ) {}

  async list(userId: string): Promise<AddressResponseDto[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId },
      include,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toResponse);
  }

  async get(userId: string, id: string): Promise<AddressResponseDto> {
    return toResponse(await this.findOwned(userId, id));
  }

  async create(userId: string, dto: CreateAddressDto): Promise<AddressResponseDto> {
    await this.regions.assertDistrictInRegion(dto.regionId, dto.districtId);
    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.count({ where: { userId } });
      const isDefault = existing === 0 || dto.isDefault === true;
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: {
          userId,
          label: dto.label,
          recipientName: dto.recipientName,
          contactPhone: dto.contactPhone,
          regionId: dto.regionId,
          districtId: dto.districtId,
          wardStreet: dto.wardStreet,
          landmark: dto.landmark ?? null,
          isDefault,
        },
        include,
      });
    });
    return toResponse(created);
  }

  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<AddressResponseDto> {
    const current = await this.findOwned(userId, id);
    if (dto.isDefault === false && current.isDefault) {
      throw new BadRequestException(
        'An address cannot be un-set as default; set another address as default instead',
      );
    }
    if (dto.regionId !== undefined || dto.districtId !== undefined) {
      await this.regions.assertDistrictInRegion(
        dto.regionId ?? current.regionId,
        dto.districtId ?? current.districtId,
      );
    }
    const { isDefault, ...fields } = dto;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (isDefault === true && !current.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.update({
        where: { id: current.id },
        data: { ...fields, ...(isDefault === true ? { isDefault: true } : {}) },
        include,
      });
    });
    return toResponse(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const current = await this.findOwned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: current.id } });
      if (!current.isDefault) return;
      const next = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (next) {
        await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  private async findOwned(userId: string, id: string): Promise<AddressWithRefs> {
    const address = await this.prisma.address.findFirst({ where: { id, userId }, include });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }
}
