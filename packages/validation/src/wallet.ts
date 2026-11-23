import { z } from 'zod';
import { cuidSchema, emailSchema, uuidSchema } from './common';

/**
 * Wallet-to-wallet P2P transfers (WALLET-P2P-API).
 *
 * `walletTopUpSchema` (the one pre-existing wallet schema) lives in
 * `marketplace.ts` for historical reasons; these are new and get their own
 * file rather than growing that one further.
 */

/** POST /wallet/transfers/recipient-lookup body. Recipient is identified by
 *  exact email only — no partial search, no autocomplete, no phone lookup. */
export const transferRecipientLookupSchema = z.object({
  email: emailSchema,
});
export type TransferRecipientLookupInput = z.infer<typeof transferRecipientLookupSchema>;

/**
 * POST /wallet/transfers body.
 *
 * `amountMinor` is a plain integer, not `z.coerce.number()` the way
 * `walletTopUpSchema` is — that schema coerces because it reads a query-adjacent
 * string-ish value; this is a typed JSON body where the client already holds an
 * integer, and coercing a string here would silently accept "100abc"-shaped
 * junk the way `Number("100abc")` would NOT, but `Number("100")` would from a
 * field that should never have been a string to begin with.
 */
export const createTransferSchema = z.object({
  recipientUserId: cuidSchema,
  amountMinor: z.number().int().positive('Enter an amount greater than zero.'),
  // Client-generated, so a retried request (double-tap, a dropped response)
  // replays the original movement instead of posting a second one.
  idempotencyKey: uuidSchema,
  note: z.string().trim().max(140, 'Keep the note to 140 characters or fewer.').optional(),
});
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
