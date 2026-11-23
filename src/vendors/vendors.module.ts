import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PayoutAccountsService } from './payout-accounts.service';
import { PublicVendorsController } from './public-vendors.controller';
import { VendorsAdminService } from './vendors-admin.service';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [UsersModule],
  // VendorsController (`vendors/me`) is registered before `vendors/:slug` so `me` is never a slug.
  controllers: [VendorsController, PublicVendorsController],
  providers: [VendorsService, VendorsAdminService, PayoutAccountsService],
  exports: [VendorsService, VendorsAdminService],
})
export class VendorsModule {}
