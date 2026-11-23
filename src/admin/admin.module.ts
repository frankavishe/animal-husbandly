import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { VendorsModule } from '../vendors/vendors.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminVendorsController } from './admin-vendors.controller';

@Module({
  imports: [UsersModule, AuthModule, VendorsModule],
  controllers: [AdminUsersController, AdminVendorsController],
  providers: [AdminUsersService],
})
export class AdminModule {}
