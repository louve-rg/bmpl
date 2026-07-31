import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CartModule } from '../cart/cart.module';
import { DeliveryPricingService } from './delivery.pricing';
import { CustomerDeliveryService, VendorDeliveryService } from './delivery.service';
import { CustomerDeliveryController, VendorDeliveryController } from './delivery.controller';

/**
 * Delivery & Shipping Foundation (M13). Vendor delivery configuration, the
 * pricing engine, and pre-checkout quotes. The pricing engine is exported so the
 * OrdersModule can price + snapshot delivery during checkout.
 */
@Module({
  imports: [PrismaModule, CartModule],
  controllers: [VendorDeliveryController, CustomerDeliveryController],
  providers: [DeliveryPricingService, VendorDeliveryService, CustomerDeliveryService],
  exports: [DeliveryPricingService],
})
export class DeliveryModule {}
