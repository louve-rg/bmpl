import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { AdminVendorsController } from './admin-vendors.controller';
import { VendorPublicController } from './vendor-public.controller';
import { VendorService } from './vendor.service';

// StorageService, NotificationsService, PrismaService, AuditService are all
// provided by @Global() modules — no imports needed here.
@Module({
  controllers: [VendorController, AdminVendorsController, VendorPublicController],
  providers: [VendorService],
  exports: [VendorService],
})
export class VendorModule {}
