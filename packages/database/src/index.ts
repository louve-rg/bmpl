import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export * from './sync-permissions';

/**
 * Shared PrismaClient singleton. In dev, reuse across hot reloads to avoid
 * exhausting the connection pool.
 */
const globalForPrisma = globalThis as unknown as { __bmplPrisma?: PrismaClient };

/**
 * BMPL-388: the query engine logs an 'error' line for every
 * PrismaClientKnownRequestError regardless of whether the calling code goes
 * on to catch it - and this codebase deliberately catches P2002 (unique
 * constraint violation) as an idempotent success or an expected conflict at
 * ~20 call sites (grep `e.code === 'P2002'` under apps/api/src: engagement,
 * wallet, payments, orders, settlement and more). Plain `log: ['error']`
 * therefore dumped a full error block for an outcome the caller already
 * handled successfully - in test AND production alike - and that noise
 * caused a real misdiagnosis in both directions in one night (a genuine
 * defect read as noise; benign noise read as a defect).
 *
 * Rejected: dropping the severity entirely in test (e.g. skipping 'error'
 * when NODE_ENV === 'test'). That also hides a genuinely unexpected error -
 * trading a false alarm for a missed defect, the opposite failure mode and
 * arguably worse, especially in a system where a missed defect can touch
 * real money.
 *
 * Fixed instead with event-based logging, filtered on the one thing that is
 * actually true of every deliberately-caught case and nothing else: a
 * P2002's message always ends with the engine's own fixed diagnostic line,
 * "Unique constraint failed on the fields: (...)". Confirmed by direct
 * probe (not assumed): the engine's `error` log event and the thrown
 * error's own `.message` are character-for-character identical for a
 * P2002, and that exact phrase never appears in an unrelated failure
 * (checked against a raw query error, which reports Postgres's own message
 * instead). Anything that is not this one fixed string still prints exactly
 * as before - a real unexpected error is never silenced, in any
 * environment.
 */
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', { level: 'error', emit: 'event' }] : [{ level: 'error', emit: 'event' }],
  });
  client.$on('error', (e) => {
    if (e.message.includes('Unique constraint failed on the fields:')) return;
    console.error(e.message);
  });
  return client;
}

export const prisma: PrismaClient = globalForPrisma.__bmplPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__bmplPrisma = prisma;
}

export type Db = PrismaClient;
