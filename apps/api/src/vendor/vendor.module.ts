import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { VendorController } from './vendor.controller';
import { AdminVendorsController } from './admin-vendors.controller';
import { VendorPublicController } from './vendor-public.controller';
import { VendorService } from './vendor.service';

// StorageService, NotificationsService, PrismaService, AuditService are all
// provided by @Global() modules. ProductsModule is imported so the storefront
// can surface a vendor's published featured products.
@Module({
  imports: [ProductsModule],
  controllers: [VendorController, AdminVendorsController, VendorPublicController],
  providers: [VendorService],
  exports: [VendorService],
})
export class VendorModule {}
