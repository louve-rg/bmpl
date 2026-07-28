import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators';
import { VendorService } from './vendor.service';

/** Public storefront surface. No auth; only APPROVED vendors are ever exposed. */
@Controller('marketplace/vendors')
export class VendorPublicController {
  constructor(private readonly vendor: VendorService) {}

  @Public()
  @Get()
  list() {
    return this.vendor.publicList();
  }

  @Public()
  @Get(':slug')
  storefront(@Param('slug') slug: string) {
    return this.vendor.publicStorefront(slug);
  }
}
