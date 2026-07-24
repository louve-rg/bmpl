import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { RedisService } from '../redis/redis.service';

/**
 * Distributed rate limiting backed by Redis, so limits hold across multiple API
 * instances (Railway can run more than one). Limits/windows are env-driven.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ENV, RedisService],
      useFactory: (env: Env, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: env.THROTTLE_TTL_SECONDS * 1000,
            limit: env.THROTTLE_LIMIT,
          },
        ],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
  ],
})
export class ThrottlingModule {}
