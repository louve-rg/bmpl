import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createCategorySchema, updateCategorySchema } from '@bmpl/validation';
import type { CreateCategoryInput, UpdateCategoryInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { CategoriesService } from './categories.service';

/**
 * Admin-managed category taxonomy. Every route requires `categories.manage`
 * (enforced by the global PermissionsGuard, independent of what the UI renders).
 */
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  @RequirePermission('categories.manage')
  list() {
    return this.categories.adminList();
  }

  @Post()
  @RequirePermission('categories.manage')
  create(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(createCategorySchema)) body: CreateCategoryInput,
  ) {
    return this.categories.create(this.actor(user, req), body);
  }

  @Patch(':id')
  @RequirePermission('categories.manage')
  update(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.categories.update(this.actor(user, req), id, body);
  }

  @Delete(':id')
  @RequirePermission('categories.manage')
  remove(@CurrentUser() user: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.categories.remove(this.actor(user, req), id);
  }
}
