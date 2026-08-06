import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UsersModule } from '../users/users.module';

@Module({
  // UsersModule supplies UsersService, which owns profile-picture moderation
  // (the queue plus approve/reject) alongside the rest of the user record.
  imports: [UsersModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
