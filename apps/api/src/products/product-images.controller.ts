import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  imagePresignSchema,
  imageReorderSchema,
  productImageConfirmSchema,
  productImageUpdateSchema,
  type ImagePresignInput,
  type ImageReorderInput,
  type ProductImageConfirmInput,
  type ProductImageUpdateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { ProductImagesService } from './product-images.service';

/** Vendor product-image manager. Owner-scoped by the caller's vendor profile. */
@Roles('VENDOR')
@Controller('vendor/products/:productId/images')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Get()
  list(@CurrentUser() user: AuthContext, @Param('productId') productId: string) {
    return this.images.listForOwner(user.userId, productId);
  }

  @StrictThrottle()
  @Post('presign')
  presign(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Body(ZodBody(imagePresignSchema)) body: ImagePresignInput,
  ) {
    return this.images.presign(user.userId, productId, body.fileName, body.contentType);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Body(ZodBody(productImageConfirmSchema)) body: ProductImageConfirmInput,
  ) {
    return this.images.confirm(user.userId, productId, body);
  }

  @Post('reorder')
  reorder(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Body(ZodBody(imageReorderSchema)) body: ImageReorderInput,
  ) {
    return this.images.reorder(user.userId, productId, body.order);
  }

  @Post(':imageId/primary')
  setPrimary(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.setPrimary(user.userId, productId, imageId);
  }

  @Patch(':imageId')
  update(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @Body(ZodBody(productImageUpdateSchema)) body: ProductImageUpdateInput,
  ) {
    return this.images.update(user.userId, productId, imageId, body);
  }

  @Delete(':imageId')
  remove(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.remove(user.userId, productId, imageId);
  }
}
