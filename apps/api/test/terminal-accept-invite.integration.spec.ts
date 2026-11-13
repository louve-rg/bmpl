/**
 * MDF-727 (TERM-ACCEPT-MSG): `TerminalService.acceptInvite` threw the exact
 * same string, "This invite link is invalid or has expired.", from two
 * genuinely different causes — a dead link (never existed, truly expired,
 * already revoked, or already consumed as of the pre-check's own read) and
 * a live, valid invite that lost a race against a SECOND concurrent accept
 * of the very same token (the overwhelmingly common real-world shape of
 * that: an invitee double-clicking or double-submitting their own link).
 * A single string assertion passed for both, so there was no regression
 * guard telling them apart in either direction.
 *
 * The fix is deliberately asymmetric, and that asymmetry IS the point:
 *  - the pre-check (a dead link by any cause) MUST stay non-committal — an
 *    invite token must not become an existence oracle, which is exactly
 *    why "invalid or expired" covers never-existed, expired, revoked AND
 *    already-consumed-as-of-that-read all alike.
 *  - the race loss (the live invite's OWN transaction lost to a second
 *    commit) can safely tell the truth, because the caller already proved
 *    they held a token that really was live a moment before — there is
 *    nothing left to probe for.
 *
 * This suite proves BOTH halves: every dead-link cause still gets the
 * generic message through the real HTTP door — including a SEQUENTIAL
 * re-submit after a completed accept, the obvious trap of "fixing" this
 * by making the pre-check smarter instead, which is also the only place an
 * ordinary (non-racing) second accept attempt is proven — and the genuine
 * concurrent race gets the new, specific one, asserted at the SERVICE
 * layer. That layer choice is deliberate, not a downgrade: see the comment
 * on the race test itself for why (MDF-727 / TERM-ACCEPT-MSG-RACE-FLAKE).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { BadRequestException } from '@nestjs/common';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { TerminalService } from '../src/terminal/terminal.service';

let ctx: TestContext;
let admin: string[];
let terminalService: TerminalService;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const postPublic = (p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).send(b);

/** One hub + one terminal company location — enough for `inviteMember`'s
 *  `locationIds` requirement. This suite never needs a route, a network, or
 *  a shipment at all; it is entirely about the invite/accept lifecycle. */
async function makeCompanyWithLocation() {
  const tag = uniq().slice(-9);
  const hub = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}H`, name: `Bus Terminal ${tag}`, type: 'BUS_TERMINAL',
    district: 'BELIZE', city: `City ${tag}`, modes: ['LAND'], courierFeeMinor: 500,
  });
  expect(hub.status).toBe(201);
  const company = await post(admin, 'admin/terminal/companies', {
    businessName: `Reef Terminals ${tag}`, contactEmail: `reef_${tag}@example.com`,
  });
  expect(company.status).toBe(201);
  const location = await post(admin, `admin/terminal/companies/${company.body.id}/locations`, { hubId: hub.body.id });
  expect(location.status).toBe(201);
  return { companyId: company.body.id as string, locationId: location.body.id as string };
}

/** Issues a real invite through the real admin endpoint, then recovers the
 *  raw token the same way MDF-709's suite already does — from the dev
 *  mailbox, never from the database (the raw token is never persisted,
 *  only its hash). */
async function inviteAndCaptureToken(companyId: string, locationId: string, email: string) {
  const invited = await post(admin, `admin/terminal/companies/${companyId}/invites`, { email, locationIds: [locationId] });
  expect(invited.status).toBe(201);
  const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
  expect(inbox.status).toBe(200);
  const token = /token=([A-Za-z0-9_-]+)/.exec(inbox.body.body)?.[1];
  expect(token).toBeDefined();
  return token!;
}

function acceptInvite(token: string, email: string) {
  return postPublic('terminal/invites/accept', { token, password: 'InviteePass123', firstName: 'Reef', lastName: 'Clerk' });
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  terminalService = ctx.app.get(TerminalService);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('MDF-727: a dead link, by any cause, stays non-committal', () => {
  it('a token that never existed', async () => {
    const res = await acceptInvite('not-a-real-token-at-all', `nobody_${uniq()}@example.com`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This invite link is invalid or has expired.');
  });

  it('a genuinely expired invite', async () => {
    const { companyId, locationId } = await makeCompanyWithLocation();
    const email = `expired_${uniq()}@example.com`;
    const token = await inviteAndCaptureToken(companyId, locationId, email);
    const invite = await ctx.prisma.terminalCompanyInvite.findFirstOrThrow({ where: { email } });
    await ctx.prisma.terminalCompanyInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await acceptInvite(token, email);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This invite link is invalid or has expired.');
  });

  it('a revoked invite', async () => {
    const { companyId, locationId } = await makeCompanyWithLocation();
    const email = `revoked_${uniq()}@example.com`;
    const token = await inviteAndCaptureToken(companyId, locationId, email);
    const invite = await ctx.prisma.terminalCompanyInvite.findFirstOrThrow({ where: { email } });
    expect((await post(admin, `admin/terminal/companies/${companyId}/invites/${invite.id}/revoke`, {})).status).toBe(201);

    const res = await acceptInvite(token, email);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This invite link is invalid or has expired.');
  });

  it('a SEQUENTIAL re-submit after a completed accept — not every "already accepted" case gets the specific message, only the race does', async () => {
    const { companyId, locationId } = await makeCompanyWithLocation();
    const email = `already_${uniq()}@example.com`;
    const token = await inviteAndCaptureToken(companyId, locationId, email);

    const first = await acceptInvite(token, email);
    expect(first.status).toBe(201);
    expect(first.body.accepted).toBe(true);

    // The pre-check's own read now sees consumedAt set — this is the dead-
    // link path (line ~302), not the race path, and it must stay generic.
    const second = await acceptInvite(token, email);
    expect(second.status).toBe(400);
    expect(second.body.message).toBe('This invite link is invalid or has expired.');
  });
});

describe('MDF-727: a genuine concurrent race tells the truth', () => {
  /**
   * MDF-727-RACE-FLAKE: this test used to fire the race as two independent
   * HTTP requests through `Promise.all` (two `supertest` calls, two real
   * sockets) and hoped that was enough to force both pre-checks to land
   * before either transaction committed. Nothing in the test or the
   * product guaranteed that — and it flaked ~1-in-3 on at least one real
   * host, with the loser occasionally getting the generic "invalid or
   * expired" message instead of this test's "already accepted" assertion.
   *
   * Diagnosis (258 trials across this host, 0 reproductions, including 40
   * runs with Prisma's own connection pool forced down to a single
   * connection — so the loser's pre-check was forced to queue behind the
   * winner's open transaction on the literal same physical connection, and
   * it STILL never produced the generic message) narrowed this to a test
   * synchronization gap, not a product defect:
   *
   *  - `acceptInvite`'s pre-check (service, ~line 301) runs OUTSIDE any
   *    transaction and with no lock. It is deliberately non-committal: a
   *    dead-link cause (never existed, expired, revoked, or already
   *    consumed AS OF THAT READ) all collapse into the same generic
   *    message on purpose, so a token can never be used as an existence
   *    oracle.
   *  - If the pre-check sees the invite live, the claim itself happens
   *    inside an interactive `$transaction`, via a CONDITIONAL
   *    `updateMany({ where: { consumedAt: null, revokedAt: null } })`.
   *    Under real Postgres MVCC/row-locking this is genuinely race-safe:
   *    if two transactions truly contend for the same row, the loser's
   *    `updateMany` blocks on the winner's row lock and only re-evaluates
   *    once that lock releases — against the WINNER'S NOW-COMMITTED row.
   *    So a loser that actually overlapped the winner at the database
   *    layer always re-reads the real, post-commit `consumedAt` and
   *    correctly reports "already accepted."
   *  - The only way to see the generic message for a request that was
   *    genuinely live a moment earlier is for that request's OWN pre-check
   *    to run AFTER the other request's entire transaction had already
   *    committed — i.e. the two requests never actually overlapped at the
   *    database layer at all. In that case the generic message is not a
   *    leak or a lie; it is correct for that moment, by the pre-check's own
   *    documented design.
   *  - Two independent HTTP round-trips (cookie plumbing, socket accept,
   *    event-loop scheduling, and the winner's request additionally paying
   *    for a deliberately slow argon2 password hash) are exactly the kind
   *    of scheduling noise that can let one request's pre-check land after
   *    the other has already fully committed, even though both calls were
   *    issued "simultaneously" from the test's point of view.
   *
   * Fix (MDF-727 ruling: option B): assert the race at the SERVICE layer
   * instead, calling `acceptInvite` directly twice via `Promise.all` with
   * no HTTP round-trip in between. This removes exactly the scheduling
   * noise identified above, so the test is finally asserting the property
   * the product actually guarantees — real database-level contention —
   * rather than hoping two independent HTTP calls happen to interleave.
   * The assertion itself is NOT weakened: the loser must still get the
   * exact specific message, never the generic one.
   *
   * The HTTP door is not left unproven: the "SEQUENTIAL re-submit" test
   * above is the HTTP-level test for an ordinary (non-racing) second
   * accept, and it proves the message a real user gets on a second,
   * non-concurrent attempt through the real door.
   */
  it('two simultaneous accepts of the same live token at the service level: one wins, the loser is told it was already accepted — not that it was invalid', async () => {
    const { companyId, locationId } = await makeCompanyWithLocation();
    const email = `race_${uniq()}@example.com`;
    const token = await inviteAndCaptureToken(companyId, locationId, email);
    const dto = { token, password: 'InviteePass123', firstName: 'Reef', lastName: 'Clerk' };

    const [a, b] = await Promise.allSettled([terminalService.acceptInvite(dto), terminalService.acceptInvite(dto)]);

    const outcomes = [a, b];
    const winners = outcomes.filter((r) => r.status === 'fulfilled');
    const losers = outcomes.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winner = winners[0] as PromiseFulfilledResult<{ accepted: boolean }>;
    const loser = losers[0] as PromiseRejectedResult;

    expect(winner.value.accepted).toBe(true);
    expect(loser.reason).toBeInstanceOf(BadRequestException);
    const loserMessage = (loser.reason as BadRequestException).message;
    expect(loserMessage).toBe('This invite has already been accepted. Please sign in instead.');
    // Never the dead-link wording — that would be a lie about a token that
    // really was live a moment before this exact call.
    expect(loserMessage).not.toBe('This invite link is invalid or has expired.');

    // Exactly one account, one ACTIVE membership — the race produced one
    // real outcome, not a duplicate or a half-applied one.
    expect(await ctx.prisma.user.count({ where: { email } })).toBe(1);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    const members = await ctx.prisma.terminalCompanyMember.findMany({ where: { terminalCompanyId: companyId, userId: user.id } });
    expect(members).toHaveLength(1);
    expect(members[0]!.status).toBe('ACTIVE');
  });
});
