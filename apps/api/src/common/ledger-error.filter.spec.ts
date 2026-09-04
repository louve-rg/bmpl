import { describe, expect, it, vi } from 'vitest';
import { LedgerError } from '@bmpl/wallet';
import { LedgerErrorFilter } from './ledger-error.filter';

/**
 * The contract: whatever the ledger refuses, the customer sees ONE clean 409
 * and never a double-entry internal. The real code goes to the log, where an
 * engineer can see it.
 */
describe('LedgerErrorFilter', () => {
  const run = (error: LedgerError) => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };
    new LedgerErrorFilter().catch(error, host as never);
    return { status, json };
  };

  it('maps a ledger refusal to a 409 with a customer-safe message', () => {
    const { status, json } = run(new LedgerError('Ledger amounts must be positive.', 'NON_POSITIVE_AMOUNT'));
    expect(status).toHaveBeenCalledWith(409);
    const body = json.mock.calls[0]![0] as { statusCode: number; message: string };
    expect(body.statusCode).toBe(409);
    expect(body.message).toBe('This payment could not be processed. Nothing was charged.');
    // The ledger's own words never reach the response.
    expect(JSON.stringify(body)).not.toMatch(/ledger|debit|credit|positive/i);
  });

  it('never leaks the code for any refusal kind', () => {
    for (const code of ['UNBALANCED', 'EMPTY', 'SINGLE_SIDED', 'MONEY_MOVEMENT_DISABLED'] as const) {
      const { json } = run(new LedgerError(`internal detail about ${code}`, code));
      const body = json.mock.calls[0]![0] as { message: string };
      expect(body.message).toBe('This payment could not be processed. Nothing was charged.');
      expect(JSON.stringify(body)).not.toContain(code);
    }
  });
});
