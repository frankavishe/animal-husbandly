import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { RegionsController } from './regions.controller';
import { RegionsService } from './regions.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, AddressesController, RegionsController],
  providers: [UsersService, RegionsService, AddressesService],
  exports: [UsersService],
})
export class UsersModule {}
