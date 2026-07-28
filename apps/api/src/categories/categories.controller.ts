import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';
import { CategoriesService } from './categories.service';

/** Public marketplace category surface. No auth; returns the VISIBLE tree only. */
@Controller('marketplace/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  tree() {
    return this.categories.publicTree();
  }
}
