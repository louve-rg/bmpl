import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthContextService } from './auth-context.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthContextService],
  exports: [AuthService, SessionService, AuthContextService],
})
export class AuthModule {}
