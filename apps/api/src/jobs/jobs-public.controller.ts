import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators';
import { JobsService } from './jobs.service';
import { JobDiscoveryService } from './job-discovery.service';
import { EmployerService } from './employer.service';

/** Public Belize Connect job browse/search + company pages (guests included). */
@Public()
@Controller('jobs')
export class JobsPublicController {
  constructor(
    private readonly jobs: JobsService,
    private readonly discovery: JobDiscoveryService,
    private readonly employers: EmployerService,
  ) {}

  @Get()
  search(
    @Query('q') q?: string,
    @Query('category') categorySlug?: string,
    @Query('district') district?: string,
    @Query('employmentType') employmentType?: string,
    @Query('workArrangement') workArrangement?: string,
    @Query('remote') remote?: string,
    @Query('salaryMin') salaryMin?: string,
    @Query('experienceLevel') experienceLevel?: string,
    @Query('educationLevel') educationLevel?: string,
    @Query('postedWithinDays') postedWithinDays?: string,
    @Query('closingSoon') closingSoon?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
  ) {
    return this.discovery.publicSearch({
      q,
      categorySlug,
      district,
      employmentType,
      workArrangement,
      remote: remote === 'true',
      salaryMin: salaryMin ? Math.round(Number(salaryMin) * 100) : undefined,
      experienceLevel,
      educationLevel,
      postedWithinDays: postedWithinDays ? Number(postedWithinDays) : undefined,
      closingSoon: closingSoon === 'true',
      sort,
      page: page ? Number(page) : 1,
    });
  }

  @Get('categories')
  categories() {
    return this.jobs.listCategories(false);
  }

  @Get('companies/:slug')
  company(@Param('slug') slug: string) {
    return this.employers.publicCompany(slug);
  }

  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.discovery.publicDetail(slug);
  }
}
