import { Module } from '@nestjs/common';
import { VendorsModule } from '../vendors/vendors.module';

@Module({
  imports: [VendorsModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class ListingsModule {}
