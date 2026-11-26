import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { ListingsModule } from '../listings/listings.module';
import { UsersModule } from '../users/users.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { SubOrderTransitionsService } from './sub-order-transitions.service';
import { VendorOrdersController } from './vendor-orders.controller';
import { VendorOrdersService } from './vendor-orders.service';

@Module({
  imports: [CartModule, ListingsModule, UsersModule, VendorsModule],
  controllers: [OrdersController, VendorOrdersController],
  providers: [SubOrderTransitionsService, CheckoutService, OrdersService, VendorOrdersService],
})
export class OrdersModule {}
