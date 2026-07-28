import { Controller, Get, Param, Query } from '@nestjs/common';
import { vendorQuerySchema, type VendorQueryInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators';
import { VendorService } from './vendor.service';

/** Public storefront surface. No auth; only APPROVED vendors are ever exposed. */
@Controller('marketplace/vendors')
export class VendorPublicController {
  constructor(private readonly vendor: VendorService) {}

  @Public()
  @Get()
  list(@Query(ZodBody(vendorQuerySchema)) query: VendorQueryInput) {
    return this.vendor.publicList(query);
  }

  @Public()
  @Get(':slug')
  storefront(@Param('slug') slug: string) {
    return this.vendor.publicStorefront(slug);
  }
}
