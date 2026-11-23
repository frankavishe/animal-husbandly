import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertPayoutAccountDto } from './dto';
import { PayoutAccountsService } from './payout-accounts.service';

async function invalidProps(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(UpsertPayoutAccountDto, plain));
  return errors.map((e) => e.property);
}

describe('PayoutAccountsService', () => {
  let prisma: any;
  let vendors: any;
  let service: PayoutAccountsService;

  beforeEach(() => {
    prisma = {
      vendorPayoutAccount: {
        upsert: jest.fn(({ update }) => Promise.resolve({ ...update, updatedAt: new Date() })),
      },
    };
    vendors = {
      findMine: jest.fn().mockResolvedValue({ id: 'v1', status: 'APPROVED', payoutAccount: null }),
      assertEditable: jest.fn(),
    };
    service = new PayoutAccountsService(prisma, vendors);
  });

  it('saves a mobile-money account and nulls bank columns', async () => {
    const res = await service.upsertMine('u1', {
      method: 'MOBILE_MONEY',
      provider: 'MPESA',
      mobileNumber: '+255754123456',
      accountName: 'Juma',
    });
    const call = prisma.vendorPayoutAccount.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ vendorId: 'v1' });
    expect(call.update).toEqual({
      method: 'MOBILE_MONEY',
      accountName: 'Juma',
      provider: 'MPESA',
      mobileNumber: '+255754123456',
      bankName: null,
      accountNumber: null,
    });
    expect(res).toEqual(expect.objectContaining({ method: 'MOBILE_MONEY', provider: 'MPESA' }));
    expect(res).not.toHaveProperty('bankName');
  });

  it('switching to BANK nulls mobile-money columns', async () => {
    await service.upsertMine('u1', {
      method: 'BANK',
      bankName: 'CRDB',
      accountNumber: '0150123456',
      accountName: 'Juma',
    });
    expect(prisma.vendorPayoutAccount.upsert.mock.calls[0][0].update).toMatchObject({
      provider: null,
      mobileNumber: null,
      bankName: 'CRDB',
      accountNumber: '0150123456',
    });
  });

  it('refuses fields of the other method', async () => {
    await expect(
      service.upsertMine('u1', {
        method: 'BANK',
        bankName: 'CRDB',
        accountNumber: '0150123456',
        accountName: 'Juma',
        provider: 'MPESA',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vendorPayoutAccount.upsert).not.toHaveBeenCalled();
  });

  it('refuses a suspended shop', async () => {
    vendors.assertEditable.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(
      service.upsertMine('u1', {
        method: 'BANK',
        bankName: 'CRDB',
        accountNumber: '0150123456',
        accountName: 'J',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates "no shop"', async () => {
    vendors.findMine.mockRejectedValue(new NotFoundException('You do not have a shop'));
    await expect(service.getMine('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when no payout account is set', async () => {
    await expect(service.getMine('u1')).rejects.toThrow('No payout account set');
  });

  describe('DTO validation', () => {
    it('accepts valid mobile and bank payloads, normalising the phone', async () => {
      const mobile = plainToInstance(UpsertPayoutAccountDto, {
        method: 'MOBILE_MONEY',
        provider: 'AIRTEL_MONEY',
        mobileNumber: '0754123456',
        accountName: 'Juma Hamisi',
      });
      expect(await validate(mobile)).toEqual([]);
      expect(mobile.mobileNumber).toBe('+255754123456');
      expect(
        await invalidProps({
          method: 'BANK',
          bankName: 'NMB',
          accountNumber: '20110012345',
          accountName: 'Juma Hamisi',
        }),
      ).toEqual([]);
    });

    it('requires provider and number for MOBILE_MONEY', async () => {
      expect(await invalidProps({ method: 'MOBILE_MONEY', accountName: 'Juma' })).toEqual(
        expect.arrayContaining(['provider', 'mobileNumber']),
      );
    });

    it('requires bank name and a 6–30 digit account number for BANK', async () => {
      expect(await invalidProps({ method: 'BANK', bankName: 'NMB', accountName: 'Juma' })).toEqual([
        'accountNumber',
      ]);
      expect(
        await invalidProps({
          method: 'BANK',
          bankName: 'NMB',
          accountNumber: '12AB45',
          accountName: 'Juma',
        }),
      ).toEqual(['accountNumber']);
    });

    it('rejects an unknown provider and method', async () => {
      expect(
        await invalidProps({
          method: 'MOBILE_MONEY',
          provider: 'PAYPAL',
          mobileNumber: '0754123456',
          accountName: 'Juma',
        }),
      ).toEqual(['provider']);
      expect(await invalidProps({ method: 'CASH', accountName: 'Juma' })).toContain('method');
    });
  });
});
