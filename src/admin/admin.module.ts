import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { UsersModule } from '../users/users.module';
import { VendorsModule } from '../vendors/vendors.module';
import { AdminListingsController } from './admin-listings.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminVendorsController } from './admin-vendors.controller';

@Module({
  imports: [UsersModule, AuthModule, VendorsModule, ListingsModule],
  controllers: [AdminUsersController, AdminVendorsController, AdminListingsController],
  providers: [AdminUsersService],
})
export class AdminModule {}
