import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PayoutMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutAccountDto, UpsertPayoutAccountDto } from './dto';
import { toPayoutAccount } from './vendor.mapper';
import { VendorsService } from './vendors.service';

const MOBILE_FIELDS = ['provider', 'mobileNumber'] as const;
const BANK_FIELDS = ['bankName', 'accountNumber'] as const;

@Injectable()
export class PayoutAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: VendorsService,
  ) {}

  async getMine(userId: string): Promise<PayoutAccountDto> {
    const vendor = await this.vendors.findMine(userId);
    if (!vendor.payoutAccount) throw new NotFoundException('No payout account set');
    return toPayoutAccount(vendor.payoutAccount);
  }

  /** FR-024/025: creates or replaces the shop's single payout account. */
  async upsertMine(userId: string, dto: UpsertPayoutAccountDto): Promise<PayoutAccountDto> {
    const vendor = await this.vendors.findMine(userId);
    this.vendors.assertEditable(vendor);
    PayoutAccountsService.assertNoForeignFields(dto);

    const isMobile = dto.method === PayoutMethod.MOBILE_MONEY;
    // Explicitly null the other method's columns so a switch never violates the DB CHECK.
    const data = {
      method: dto.method,
      accountName: dto.accountName,
      provider: isMobile ? dto.provider! : null,
      mobileNumber: isMobile ? dto.mobileNumber! : null,
      bankName: isMobile ? null : dto.bankName!,
      accountNumber: isMobile ? null : dto.accountNumber!,
    } satisfies Prisma.VendorPayoutAccountUncheckedUpdateInput;

    const account = await this.prisma.vendorPayoutAccount.upsert({
      where: { vendorId: vendor.id },
      create: { vendorId: vendor.id, ...data },
      update: data,
    });
    return toPayoutAccount(account);
  }

  static assertNoForeignFields(dto: UpsertPayoutAccountDto): void {
    const foreign = dto.method === PayoutMethod.MOBILE_MONEY ? BANK_FIELDS : MOBILE_FIELDS;
    const sent = foreign.filter((f) => dto[f] !== undefined && dto[f] !== null);
    if (sent.length) {
      throw new BadRequestException(
        sent.map((f) => `${f} is not allowed for ${dto.method} payouts`),
      );
    }
  }
}
