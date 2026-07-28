import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  addOptionValueSchema,
  createOptionSchema,
  createVariantSchema,
  updateVariantSchema,
  type AddOptionValueInput,
  type CreateOptionInput,
  type CreateVariantInput,
  type UpdateVariantInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { VariantsService } from './variants.service';

/** Vendor variant/option manager. Owner-scoped by the caller's vendor profile. */
@Roles('VENDOR')
@Controller('vendor/products/:productId')
export class ProductVariantsController {
  constructor(private readonly variants: VariantsService) {}

  @Get('variants')
  list(@CurrentUser() user: AuthContext, @Param('productId') productId: string) {
    return this.variants.listForOwner(user.userId, productId);
  }

  @Post('options')
  createOption(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Body(ZodBody(createOptionSchema)) body: CreateOptionInput,
  ) {
    return this.variants.createOption(user.userId, productId, body);
  }

  @Post('options/:optionId/values')
  addValue(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('optionId') optionId: string,
    @Body(ZodBody(addOptionValueSchema)) body: AddOptionValueInput,
  ) {
    return this.variants.addValue(user.userId, productId, optionId, body.value);
  }

  @Delete('options/:optionId')
  deleteOption(@CurrentUser() user: AuthContext, @Param('productId') productId: string, @Param('optionId') optionId: string) {
    return this.variants.deleteOption(user.userId, productId, optionId);
  }

  @Delete('option-values/:valueId')
  deleteValue(@CurrentUser() user: AuthContext, @Param('productId') productId: string, @Param('valueId') valueId: string) {
    return this.variants.deleteValue(user.userId, productId, valueId);
  }

  @Post('variants')
  createVariant(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Body(ZodBody(createVariantSchema)) body: CreateVariantInput,
  ) {
    return this.variants.createVariant(user.userId, productId, body);
  }

  @Patch('variants/:variantId')
  updateVariant(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body(ZodBody(updateVariantSchema)) body: UpdateVariantInput,
  ) {
    return this.variants.updateVariant(user.userId, productId, variantId, body);
  }

  @Delete('variants/:variantId')
  deleteVariant(@CurrentUser() user: AuthContext, @Param('productId') productId: string, @Param('variantId') variantId: string) {
    return this.variants.deleteVariant(user.userId, productId, variantId);
  }
}
