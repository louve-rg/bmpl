import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export * from './sync-permissions';

/**
 * Shared PrismaClient singleton. In dev, reuse across hot reloads to avoid
 * exhausting the connection pool.
 */
const globalForPrisma = globalThis as unknown as { __bmplPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__bmplPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__bmplPrisma = prisma;
}

export type Db = PrismaClient;
