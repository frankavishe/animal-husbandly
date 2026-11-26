import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { ListingsModule } from '../listings/listings.module';
import { UsersModule } from '../users/users.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { SubOrderTransitionsService } from './sub-order-transitions.service';

@Module({
  imports: [CartModule, ListingsModule, UsersModule, VendorsModule],
  controllers: [OrdersController],
  providers: [SubOrderTransitionsService, CheckoutService, OrdersService],
})
export class OrdersModule {}
