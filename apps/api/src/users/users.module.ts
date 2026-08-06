import { Module } from '@nestjs/common';
import { UserAvatarController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, UserAvatarController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
