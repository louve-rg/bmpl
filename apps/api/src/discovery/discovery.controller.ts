import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { DiscoveryService } from './discovery.service';

/**
 * Public discovery surfaces (M21): the homepage bundle, product-detail cross-sell,
 * and search typeahead. All read-only, no auth required, PUBLISHED/APPROVED only.
 */
@Public()
@Controller('marketplace')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('discovery')
  homepage() {
    return this.discovery.homepage();
  }

  @Get('products/:slug/related')
  related(@Param('slug') slug: string) {
    return this.discovery.relatedBySlug(slug);
  }

  @Get('search/suggest')
  suggest(@Query('q') q?: string) {
    return this.discovery.suggest(q ?? '');
  }
}

/** Personalized recommendations for the authenticated customer (own signals only). */
@Roles('CUSTOMER')
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('for-you')
  forYou(@CurrentUser() u: AuthContext) {
    return this.discovery.forYou(u.userId);
  }
}
