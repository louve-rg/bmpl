import { Catch, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { LedgerError } from '@bmpl/wallet';
import type { Response } from 'express';

/**
 * A LedgerError is the wallet's double-entry validation refusing a transaction
 * (UNBALANCED, EMPTY, NON_POSITIVE_AMOUNT, SINGLE_SIDED, MONEY_MOVEMENT_DISABLED).
 * It extends plain Error, so before this filter existed one that escaped a
 * service reached the customer as a bare 500 carrying ledger internals —
 * "Ledger amounts must be positive." is a sentence no customer should ever
 * read, and a real customer did (zero-total shipment booking, since refused
 * upstream).
 *
 * The mapping is 409, matching how the payments module already reports money
 * refusals (insufficient balance, wrong-state payment are ConflictExceptions):
 * from the caller's side the request could not be processed, and nothing was
 * charged — every ledger write happens inside a transaction that this error
 * rolls back. The REAL code and message go to the error log, because an
 * UNBALANCED or SINGLE_SIDED draft is an engineering defect somebody must see;
 * the response body stays generic, because the customer must not.
 */
@Catch(LedgerError)
export class LedgerErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(LedgerErrorFilter.name);

  catch(exception: LedgerError, host: ArgumentsHost) {
    this.logger.error(`the ledger refused a transaction: ${exception.code} — ${exception.message}`);
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'This payment could not be processed. Nothing was charged.',
    });
  }
}
