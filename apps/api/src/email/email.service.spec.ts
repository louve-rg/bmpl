import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service';
import type { Env } from '../config/env';
import type { DevMailboxService } from '../notifications/dev-mailbox.service';

/** Minimal Env stub; only email-related fields matter here. */
function env(overrides: Partial<Env>): Env {
  return {
    EMAIL_PROVIDER: 'console',
    EMAIL_FROM: 'Belize Marketplace & Logistics <no-reply@bzemarketplace.com>',
    RESEND_API_KEY: undefined,
    SMTP_URL: undefined,
    ...overrides,
  } as Env;
}

/** MDF-709 follow-up: EmailService now records every delivered send into the
 *  dev mailbox itself (previously each of three callers did this ad hoc).
 *  A fake, not a real DevMailboxService — these tests only need to observe
 *  whether/how `record` was called. */
function fakeDevMailbox(): DevMailboxService {
  return { record: vi.fn() } as unknown as DevMailboxService;
}

const message = { to: 'user@example.bz', subject: 'Verify your account', body: 'token=secret-token-do-not-log' };

describe('EmailService — console provider (default)', () => {
  const svc = new EmailService(env({ EMAIL_PROVIDER: 'console' }), fakeDevMailbox());

  it('send() still returns true — existing callers (dev mailbox, auth flows) are unaffected', async () => {
    await expect(svc.send(message)).resolves.toBe(true);
  });

  it('sendDetailed() marks it "simulated", not "sent" — this is the whole point: the caller can tell nothing was delivered', async () => {
    const result = await svc.sendDetailed(message);
    expect(result.delivered).toBe(true);
    expect(result.outcome).toBe('simulated');
    expect(result.outcome).not.toBe('sent');
  });

  it('never logs the email body (it carries verification/reset tokens)', async () => {
    const logSpy = vi.spyOn((svc as unknown as { logger: { log: (...a: unknown[]) => void } }).logger, 'log');
    await svc.send(message);
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain(message.body);
    expect(logged).not.toContain('secret-token-do-not-log');
  });

  it('getDiagnostics() reports console as unable to deliver, with no credential required', () => {
    expect(svc.getDiagnostics()).toEqual({ provider: 'console', credentialPresent: true, canDeliver: false });
  });
});

/**
 * MDF-709 follow-up: this is the centralization fix itself, verified at the
 * unit level — the dev mailbox used to be filled by whichever CALLER
 * remembered to do it (three ad-hoc sites), which is exactly how the
 * MDF-709 reveal email went unrecorded and untestable. Recording lives
 * here now, once, for every caller.
 */
describe('EmailService — dev mailbox capture lives here now, not in each caller', () => {
  it('records a delivered (console/"simulated") send into the dev mailbox exactly once', async () => {
    const devMailbox = fakeDevMailbox();
    const svc = new EmailService(env({ EMAIL_PROVIDER: 'console' }), devMailbox);
    await svc.sendDetailed(message);
    expect(devMailbox.record).toHaveBeenCalledTimes(1);
    expect(devMailbox.record).toHaveBeenCalledWith(
      expect.objectContaining({ to: message.to, subject: message.subject, body: message.body }),
    );
  });

  it('does NOT record a send that was never delivered (missing credential)', async () => {
    const devMailbox = fakeDevMailbox();
    const svc = new EmailService(env({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: undefined }), devMailbox);
    await svc.sendDetailed(message);
    expect(devMailbox.record).not.toHaveBeenCalled();
  });
});

describe('EmailService — resend provider, credential missing', () => {
  const svc = new EmailService(env({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: undefined }), fakeDevMailbox());

  it('send() returns false (never silently claims delivery without a credential)', async () => {
    await expect(svc.send(message)).resolves.toBe(false);
  });

  it('sendDetailed() reports missing_credential, not provider_error', async () => {
    const result = await svc.sendDetailed(message);
    expect(result).toEqual({ delivered: false, outcome: 'missing_credential' });
  });

  it('getDiagnostics() reports the credential as absent and delivery as impossible', () => {
    expect(svc.getDiagnostics()).toEqual({ provider: 'resend', credentialPresent: false, canDeliver: false });
  });
});

describe('EmailService — resend provider, credential present', () => {
  const svc = new EmailService(env({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-only-key-never-real' }), fakeDevMailbox());
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('send() returns true and sendDetailed() reports "sent" on a real accepted call', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await expect(svc.send(message)).resolves.toBe(true);
    fetchMock.mockResolvedValue({ ok: true });
    await expect(svc.sendDetailed(message)).resolves.toEqual({ delivered: true, outcome: 'sent' });
  });

  it('never sends the credential anywhere but the Authorization header', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await svc.send(message);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-only-key-never-real');
    expect(init.body as string).not.toContain('test-only-key-never-real');
  });

  it('a provider-side rejection (bad key, unverified domain) reports provider_error, not sent', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => 'domain not verified' });
    const result = await svc.sendDetailed(message);
    expect(result).toEqual({ delivered: false, outcome: 'provider_error' });
  });

  it('a network failure reports provider_error rather than throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(svc.sendDetailed(message)).resolves.toEqual({ delivered: false, outcome: 'provider_error' });
  });

  it('getDiagnostics() reports the credential present and delivery possible — no value, prefix or length is exposed', () => {
    const diag = svc.getDiagnostics() as unknown as Record<string, unknown>;
    expect(diag).toEqual({ provider: 'resend', credentialPresent: true, canDeliver: true });
    expect(JSON.stringify(diag)).not.toContain('test-only-key-never-real');
  });
});

describe('EmailService — smtp provider (not implemented)', () => {
  it('send() returns false regardless of SMTP_URL — the transport genuinely does not exist yet', async () => {
    const withUrl = new EmailService(env({ EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtps://example.bz' }), fakeDevMailbox());
    await expect(withUrl.send(message)).resolves.toBe(false);
    await expect(withUrl.sendDetailed(message)).resolves.toEqual({ delivered: false, outcome: 'not_implemented' });

    const withoutUrl = new EmailService(env({ EMAIL_PROVIDER: 'smtp', SMTP_URL: undefined }), fakeDevMailbox());
    await expect(withoutUrl.send(message)).resolves.toBe(false);
  });

  it('getDiagnostics() reports canDeliver=false even when SMTP_URL is set', () => {
    const svc = new EmailService(env({ EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtps://example.bz' }), fakeDevMailbox());
    expect(svc.getDiagnostics()).toEqual({ provider: 'smtp', credentialPresent: true, canDeliver: false });
  });
});
