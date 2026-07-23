import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';

/** Registered only outside production (see AppModule). */
@Module({
  controllers: [DevController],
})
export class DevModule {}
