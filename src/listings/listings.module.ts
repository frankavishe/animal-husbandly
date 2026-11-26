import { Module } from '@nestjs/common';
import { VendorsModule } from '../vendors/vendors.module';
import { ListingPhotosService } from './listing-photos.service';
import { ListingStockService } from './listing-stock.service';
import { ListingsAdminService } from './listings-admin.service';
import { ListingsService } from './listings.service';
import { PublicListingsController } from './public-listings.controller';
import { VendorListingsController } from './vendor-listings.controller';

@Module({
  imports: [VendorsModule],
  controllers: [VendorListingsController, PublicListingsController],
  providers: [ListingsService, ListingPhotosService, ListingsAdminService, ListingStockService],
  exports: [ListingsAdminService, ListingStockService],
})
export class ListingsModule {}
