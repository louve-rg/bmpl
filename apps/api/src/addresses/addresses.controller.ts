import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { savedAddressSchema, savedAddressUpdateSchema, type SavedAddressInput, type SavedAddressUpdateInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { AddressesService } from './addresses.service';

/** The signed-in customer's saved addresses. Self-scoped throughout. */
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() u: AuthContext) {
    return this.addresses.list(u.userId);
  }

  @Post()
  create(@CurrentUser() u: AuthContext, @Body(ZodBody(savedAddressSchema)) dto: SavedAddressInput) {
    return this.addresses.create(u.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(savedAddressUpdateSchema)) dto: SavedAddressUpdateInput) {
    return this.addresses.update(u.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.addresses.remove(u.userId, id);
  }
}
