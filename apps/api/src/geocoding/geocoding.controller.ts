import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import { GeocodingService } from './geocoding.service';

/**
 * Address → coordinates, for the checkout map.
 *
 * Signed-in only (`CUSTOMER` is the baseline role every account holds) and
 * strictly throttled. Both matter: this endpoint spends a shared, unpaid
 * OpenStreetMap quota on BMPL's behalf, so it must not be an open relay.
 */
@Roles('CUSTOMER')
@Controller('geocode')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @StrictThrottle()
  @Get()
  async search(@Query('q') q?: string, @Query('district') district?: string) {
    const results = await this.geocoding.search(q ?? '', district);
    return {
      results,
      // The UI says this outright rather than implying a failed lookup means a
      // bad address: OpenStreetMap's Belize coverage is genuinely incomplete.
      exhaustive: false,
    };
  }
}
