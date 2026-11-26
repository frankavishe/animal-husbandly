import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { ListingsModule } from '../listings/listings.module';
import { UsersModule } from '../users/users.module';
import { VendorsModule } from '../vendors/vendors.module';
import { SubOrderTransitionsService } from './sub-order-transitions.service';

@Module({
  imports: [CartModule, ListingsModule, UsersModule, VendorsModule],
  providers: [SubOrderTransitionsService],
})
export class OrdersModule {}
