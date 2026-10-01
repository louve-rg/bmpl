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
 * Fixed instead with event-based logging, filtered on the engine's own
 * fixed diagnostic line for this error CLASS, "Unique constraint failed on
 * the fields: (...)". Confirmed by direct probe (not assumed): the engine's
 * `error` log event and the thrown error's own `.message` are
 * character-for-character identical for a P2002, and that exact phrase
 * never appears in an unrelated failure (checked against a raw query error,
 * which reports Postgres's own message instead).
 *
 * THE FILTER DISCRIMINATES BY ERROR CLASS, NOT BY WHETHER ANYONE CAUGHT IT -
 * `LogEvent` carries no `.code`, only `.message`, so there is no structural
 * way to ask "was this one handled?" at this layer. A 21st P2002 at a call
 * site nobody anticipated is just as silent HERE as the 20 expected ones.
 * That is only safe because of what happens next, confirmed by a second
 * probe, not assumed: nothing in this codebase registers a filter for
 * `PrismaClientKnownRequestError` (`apps/api/src/app.module.ts`'s only
 * `APP_FILTER` is `LedgerErrorFilter`, scoped to `LedgerError`), so an
 * uncaught P2002 reaches Nest's own built-in `ExceptionsHandler`, which
 * logs the exact same full error block - through the same logger
 * `main.ts` hands `NestFactory.create` - independently of anything this
 * file does, and still turns it into a 500. THE SAFETY NET FOR AN
 * UNEXPECTED P2002 IS NEST'S DEFAULT EXCEPTION HANDLING, NOT THIS FILTER -
 * this file only ever silences the Prisma-layer line for an error class
 * every known caller already treats as success, trusting Nest to still
 * report it loudly the moment one isn't caught.
 *
 * Two honest limits, left as-is rather than engineered around:
 * - The substring is a Prisma-version-fragile match. An upstream wording
 *   change would silently stop filtering - which fails safe (the old noise
 *   returns, nothing goes unlogged), but would do so without a red test
 *   anywhere. Not added here to keep this one small; a candidate for a
 *   follow-up card if that silent drift risk is worth guarding explicitly.
 * - `console.error(e.message)` is a deliberately slimmer line than the old
 *   stdout emission: it keeps the message and drops `e.target`/
 *   `e.timestamp`, since both show up again in Nest's own built-in logging
 *   format for any error this layer doesn't swallow, every value this
 *   layer can swallow is a case every caller already treats as a success,
 *   and the node process's own stderr line already carries a wall-clock
 *   time.
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
