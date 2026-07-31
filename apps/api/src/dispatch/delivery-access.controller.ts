import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { DeliveryAccessService } from './delivery-access.service';

/**
 * Customer delivery tracking for their OWN orders: status, timeline, assigned
 * driver display name + vehicle summary, proof of delivery, and the recipient
 * delivery PIN (shared with the driver on arrival). No private driver documents
 * or emergency contact are ever exposed.
 */
@Roles('CUSTOMER')
@Controller('deliveries')
export class CustomerDeliveryController {
  constructor(private readonly access: DeliveryAccessService) {}

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.access.customerGet(u.userId, id);
  }

  @Get(':id/pin')
  pin(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.access.customerDeliveryPin(u.userId, id);
  }

  @Get(':id/proof')
  proof(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.access.customerProof(u.userId, id);
  }
}

/**
 * Vendor delivery visibility for their OWN vendor-orders: assigned driver +
 * vehicle, delivery progress, proof of delivery, and the pickup PIN they hand to
 * the driver at pickup. Vendors CANNOT assign drivers.
 */
@Roles('VENDOR')
@Controller('vendor/deliveries')
export class VendorDeliveryStatusController {
  constructor(private readonly access: DeliveryAccessService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query('scope') scope?: string) {
    return this.access.vendorList(u.userId, scope);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.access.vendorGet(u.userId, id);
  }

  @Get(':id/pickup-pin')
  pickupPin(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.access.vendorPickupPin(u.userId, id);
  }

  @Get(':id/proof')
  proof(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.access.vendorProof(u.userId, id);
  }
}
