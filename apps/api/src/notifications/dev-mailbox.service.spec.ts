/**
 * MDF-728: the dev mailbox used to be in-memory only, so any process
 * restart silently wiped it — a resend could return HTTP 201 with
 * `delivery.delivered: true` and the next read 404, with nothing on screen
 * saying why. This proves the fix actually survives a process boundary,
 * not merely that a write succeeds: each test constructs a SECOND, wholly
 * independent `DevMailboxService` instance with no reference to the
 * first's in-memory buffer — the only way it can see what the first
 * instance recorded is by reading it back off disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DevMailboxService, type CapturedEmail } from './dev-mailbox.service';

const FILE_PATH = join(process.cwd(), '.dev-mailbox.json');

function uniqueEmail(overrides: Partial<CapturedEmail> = {}): CapturedEmail {
  const to = `mdf728_${Math.random().toString(36).slice(2)}@example.com`;
  return { to, subject: 'Test', body: 'body', createdAt: new Date().toISOString(), ...overrides };
}

beforeEach(() => {
  // A clean slate per test, not a shared accumulating file — otherwise an
  // earlier test's entries (or a developer's own running dev server in
  // this same worktree) could make the ring-buffer-cap test's count
  // non-deterministic.
  if (existsSync(FILE_PATH)) rmSync(FILE_PATH);
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (existsSync(FILE_PATH)) rmSync(FILE_PATH);
});

describe('DevMailboxService — survives a process restart (MDF-728)', () => {
  it('a mail recorded by one instance is readable from a second, independent instance', () => {
    const mail = uniqueEmail();

    const beforeRestart = new DevMailboxService();
    beforeRestart.record(mail);

    // Simulates the process boundary: a brand-new instance, no shared
    // in-memory state with `beforeRestart` at all — the only channel
    // between them is the file.
    const afterRestart = new DevMailboxService();
    expect(afterRestart.latestFor(mail.to)).toEqual(mail);
  });

  it('the most recent of several mails for the same address survives the restart, not just the first', () => {
    const to = `mdf728_${Math.random().toString(36).slice(2)}@example.com`;
    const first = uniqueEmail({ to, subject: 'First' });
    const second = uniqueEmail({ to, subject: 'Second' });

    const beforeRestart = new DevMailboxService();
    beforeRestart.record(first);
    beforeRestart.record(second);

    const afterRestart = new DevMailboxService();
    expect(afterRestart.latestFor(to)).toEqual(second);
  });

  it('the ring-buffer cap is still honoured across a restart — it cannot grow unbounded on disk', () => {
    const instanceA = new DevMailboxService();
    // One more than the documented cap (200): the 201st push must evict
    // the very first, in BOTH the in-memory buffer and whatever persists.
    const mails = Array.from({ length: 201 }, (_, i) => uniqueEmail({ subject: `#${i}` }));
    for (const m of mails) instanceA.record(m);

    const instanceB = new DevMailboxService();
    expect(instanceB.latestFor(mails[0]!.to)).toBeUndefined(); // evicted
    expect(instanceB.latestFor(mails[200]!.to)).toEqual(mails[200]); // survived
  });

  it('never touches disk when disabled (NODE_ENV=production) — dev/test only, by design', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const mail = uniqueEmail();

    const prodInstance = new DevMailboxService();
    prodInstance.record(mail);

    expect(existsSync(FILE_PATH)).toBe(false);
    expect(prodInstance.latestFor(mail.to)).toBeUndefined();
  });

  it('a corrupt persisted file does not crash construction — it degrades to an empty mailbox', () => {
    writeFileSync(FILE_PATH, '{ not valid json', 'utf8');

    expect(() => new DevMailboxService()).not.toThrow();
    expect(new DevMailboxService().latestFor('anyone@example.com')).toBeUndefined();
  });
});
