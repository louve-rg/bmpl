import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './logging.interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class ObservabilityModule {}
