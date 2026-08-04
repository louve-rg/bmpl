import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  imagePresignSchema,
  imageReorderSchema,
  productImageConfirmSchema,
  productImageReplaceSchema,
  productImageUpdateSchema,
  type ImagePresignInput,
  type ImageReorderInput,
  type ProductImageConfirmInput,
  type ProductImageReplaceInput,
  type ProductImageUpdateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { ProductImagesService } from './product-images.service';

/** Parse a positive integer from a query value; undefined when absent/invalid. */
function posInt(v: string | undefined): number | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** Vendor product-image manager. Owner-scoped by the caller's vendor profile. */
@Roles('VENDOR')
@Controller('vendor/products/:productId/images')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Get()
  list(@CurrentUser() user: AuthContext, @Param('productId') productId: string) {
    return this.images.listForOwner(user.userId, productId);
  }

  /**
   * Server-side image upload: the browser POSTs the raw file bytes (Content-Type
   * = the image MIME) through the same-origin web `/api` proxy; a scoped
   * express.raw() parser (see main.ts) exposes them as `req.body: Buffer`. This
   * avoids a cross-origin browser PUT to the storage endpoint (the "Load failed"
   * cause on mobile). Metadata (variantId + measured dimensions) rides on the
   * query string since the body is the binary file.
   */
  @StrictThrottle()
  @Post('upload')
  upload(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Req() req: Request,
  ) {
    const q = req.query as Record<string, string | undefined>;
    const body = Buffer.isBuffer(req.body) ? req.body : undefined;
    return this.images.upload(user.userId, productId, body, {
      variantId: q.variantId || undefined,
      width: posInt(q.width),
      height: posInt(q.height),
      altText: typeof q.altText === 'string' ? q.altText : undefined,
    });
  }

  /** Server-side in-place file replace (raw body, same transport as upload). */
  @StrictThrottle()
  @Post(':imageId/replace-file')
  replaceFile(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @Req() req: Request,
  ) {
    const q = req.query as Record<string, string | undefined>;
    const body = Buffer.isBuffer(req.body) ? req.body : undefined;
    return this.images.replaceFile(user.userId, productId, imageId, body, {
      width: posInt(q.width),
      height: posInt(q.height),
    });
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

  @Post(':imageId/replace')
  replace(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @Body(ZodBody(productImageReplaceSchema)) body: ProductImageReplaceInput,
  ) {
    return this.images.replace(user.userId, productId, imageId, body);
  }

  @Post(':imageId/brand')
  setBrandImage(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.setBrandImage(user.userId, productId, imageId);
  }

  @Delete(':imageId/brand')
  clearBrandImage(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.clearBrandImage(user.userId, productId, imageId);
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
