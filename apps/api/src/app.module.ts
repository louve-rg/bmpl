import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { DevModule } from './dev/dev.module';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from './auth/guards';

// Dev/test-only modules are excluded entirely from production builds at runtime.
const devModules = process.env.NODE_ENV === 'production' ? [] : [DevModule];

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    NotificationsModule,
    StorageModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AdminModule,
    HealthModule,
    ...devModules,
  ],
  providers: [
    // Global guard chain: authenticate (unless @Public), then role, then permission.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
