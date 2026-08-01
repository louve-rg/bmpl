import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { updateFeeConfigSchema, type UpdateFeeConfigInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { SettlementService } from './settlement.service';

/** Vendor: own settlements (M18). */
@Roles('VENDOR')
@Controller('vendor/settlements')
export class VendorSettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get()
  list(@CurrentUser() u: AuthContext) {
    return this.settlement.vendorSettlements(u.userId);
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.settlement.vendorSettlementDetail(u.userId, id);
  }
}

/** Driver: own earnings (M18). */
@Roles('DELIVERY_DRIVER')
@Controller('driver/earnings')
export class DriverEarningsController {
  constructor(private readonly settlement: SettlementService) {}

  @Get()
  list(@CurrentUser() u: AuthContext) {
    return this.settlement.driverEarnings(u.userId);
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.settlement.driverEarningDetail(u.userId, id);
  }
}

/** Customer: settlement status of an own order (read-only). */
@Roles('CUSTOMER')
@Controller('orders')
export class CustomerSettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get(':id/settlement')
  status(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.settlement.customerOrderSettlement(u.userId, id);
  }
}

/** Admin: settlements, driver earnings, escrow/internal balances, reconciliation,
 *  fee config, and retry of failed settlements. No manual balance/ledger edits. */
@Controller('admin/settlements')
export class AdminSettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get()
  @RequirePermission('settlements.read')
  list(@Query('status') status?: string) {
    return this.settlement.adminList({ status });
  }

  @Get('reconciliation')
  @RequirePermission('settlements.read')
  reconciliation() {
    return this.settlement.reconciliation();
  }

  @Get('accounts')
  @RequirePermission('settlements.read')
  accounts() {
    return this.settlement.adminAccounts();
  }

  @Get('driver-earnings')
  @RequirePermission('settlements.read')
  driverEarnings() {
    return this.settlement.adminDriverEarnings();
  }

  @Get('exceptions')
  @RequirePermission('settlements.read')
  exceptions() {
    return this.settlement.adminExceptions();
  }

  @Get('fee-config')
  @RequirePermission('settlements.read')
  getFeeConfig() {
    return this.settlement.getFeeConfig();
  }

  @Patch('fee-config')
  @RequirePermission('settlements.manage')
  updateFeeConfig(@CurrentUser() u: AuthContext, @Body(ZodBody(updateFeeConfigSchema)) b: UpdateFeeConfigInput) {
    return this.settlement.updateFeeConfig(u.userId, b);
  }

  @Get(':id')
  @RequirePermission('settlements.read')
  detail(@Param('id') id: string) {
    return this.settlement.adminDetail(id);
  }

  @Post('vendor-order/:vendorOrderId/retry')
  @RequirePermission('settlements.manage')
  retry(@CurrentUser() u: AuthContext, @Param('vendorOrderId') vendorOrderId: string) {
    return this.settlement.retry(u.userId, vendorOrderId);
  }
}
