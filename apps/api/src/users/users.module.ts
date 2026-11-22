import { Module } from '@nestjs/common';
import { VendorModule } from '../vendor/vendor.module';
import { UserAvatarController, UsersController } from './users.controller';
import { UsersService } from './users.service';

// VendorModule supplies VendorService.moderate(), reused as-is by
// deleteAccount to suspend a departing vendor's storefront (MDF-924) — see
// the comment on that call site for why the existing admin mechanism is
// reused rather than a parallel one.
@Module({
  imports: [VendorModule],
  controllers: [UsersController, UserAvatarController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
