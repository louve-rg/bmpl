import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@bmpl/database';

/** Thin NestJS wrapper around the shared PrismaClient. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  /**
   * Connect best-effort at startup. A DB that is briefly unreachable at boot
   * (e.g. Postgres still starting, or a transient network hiccup on a PaaS)
   * must NOT crash the process — otherwise liveness (`GET /api/health`) never
   * comes up and the platform's healthcheck fails / the container crash-loops.
   * Prisma lazily (re)connects on the first query, and `/api/health/ready`
   * reports the real database state until then.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connection established.');
    } catch (err) {
      this.logger.error(
        `Initial database connection failed; continuing to start (will retry on first query): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
    } catch {
      /* ignore disconnect errors during shutdown */
    }
  }
}
