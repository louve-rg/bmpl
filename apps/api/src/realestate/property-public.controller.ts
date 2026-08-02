import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators';
import { PropertyDiscoveryService } from './property-discovery.service';
import { AgentService } from './agent.service';
import { AgencyService } from './agency.service';

/** Public real-estate browse/search + agent/agency pages + listing detail (guests included). */
@Public()
@Controller('properties')
export class PropertyPublicController {
  constructor(
    private readonly discovery: PropertyDiscoveryService,
    private readonly agents: AgentService,
    private readonly agencies: AgencyService,
  ) {}

  @Get()
  search(
    @Query('q') q?: string,
    @Query('purpose') purpose?: string,
    @Query('propertyType') propertyType?: string,
    @Query('district') district?: string,
    @Query('locality') locality?: string,
    @Query('priceMin') priceMin?: string,
    @Query('priceMax') priceMax?: string,
    @Query('bedrooms') bedrooms?: string,
    @Query('bathrooms') bathrooms?: string,
    @Query('minPropertySize') minPropertySize?: string,
    @Query('minLandSize') minLandSize?: string,
    @Query('furnishing') furnishing?: string,
    @Query('amenities') amenities?: string,
    @Query('availableNow') availableNow?: string,
    @Query('agentSlug') agentSlug?: string,
    @Query('agencySlug') agencySlug?: string,
    @Query('includeSold') includeSold?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
  ) {
    return this.discovery.publicSearch({
      q,
      purpose,
      propertyType,
      district,
      locality,
      priceMin: priceMin ? Math.round(Number(priceMin) * 100) : undefined,
      priceMax: priceMax ? Math.round(Number(priceMax) * 100) : undefined,
      bedrooms: bedrooms ? Number(bedrooms) : undefined,
      bathrooms: bathrooms ? Number(bathrooms) : undefined,
      minPropertySize: minPropertySize ? Number(minPropertySize) : undefined,
      minLandSize: minLandSize ? Number(minLandSize) : undefined,
      furnishing,
      amenities: amenities ? amenities.split(',').map((a) => a.trim()).filter(Boolean) : undefined,
      availableNow: availableNow === 'true',
      agentSlug,
      agencySlug,
      includeSold: includeSold === 'true',
      sort,
      page: page ? Number(page) : 1,
    });
  }

  // ---- static routes before :slug ----
  @Get('agents/:slug')
  agent(@Param('slug') slug: string) {
    return this.discovery.agentListings(slug);
  }

  @Get('agencies/:slug')
  agency(@Param('slug') slug: string) {
    return this.discovery.agencyListings(slug);
  }

  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.discovery.publicDetail(slug);
  }
}
