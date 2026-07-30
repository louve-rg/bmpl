import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { ProductsService } from './products.service';

/** Vendor-owner product management. Owner-scoped by the caller's vendor profile. */
@Roles('VENDOR')
@Controller('vendor/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.products.listOwn(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(createProductSchema)) body: CreateProductInput,
  ) {
    return this.products.create(this.actor(user, req), body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.products.getOwn(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.products.update(this.actor(user, req), id, body);
  }

  @Post(':id/archive')
  archive(@CurrentUser() user: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.products.archive(this.actor(user, req), id);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() user: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.products.unarchive(this.actor(user, req), id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.products.remove(this.actor(user, req), id);
  }
}
