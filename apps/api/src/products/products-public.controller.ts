import { Controller, Get, Param, Query } from '@nestjs/common';
import { productQuerySchema, type ProductQueryInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators';
import { ProductsService } from './products.service';

/** Public product catalog. Only PUBLISHED products of APPROVED vendors are exposed. */
@Controller('marketplace/products')
export class ProductsPublicController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  list(@Query(ZodBody(productQuerySchema)) query: ProductQueryInput) {
    return this.products.publicList(query);
  }

  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.products.publicDetail(slug);
  }
}
