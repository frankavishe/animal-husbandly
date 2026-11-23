import { Module } from '@nestjs/common';
import { VendorsModule } from '../vendors/vendors.module';
import { ListingsService } from './listings.service';
import { PublicListingsController } from './public-listings.controller';
import { VendorListingsController } from './vendor-listings.controller';

@Module({
  imports: [VendorsModule],
  controllers: [VendorListingsController, PublicListingsController],
  providers: [ListingsService],
  exports: [],
})
export class ListingsModule {}
