import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
  createdAt: string;
}

/**
 * MDF-728: this buffer used to live in memory only, so every `nest start
 * --watch` recompile-triggered restart silently wiped it — a resend could
 * return HTTP 201 with `delivery.delivered: true` and the read 404 under
 * three minutes later, with nothing on screen saying why. Dwight hunted the
 * actual restart trigger and came up empty (swept apps/api/src, every
 * packages/*\/dist .d.ts, repo-root scripts/, no project-references setup).
 * Rather than keep hunting, this makes the mail outlive the process: every
 * `record()` also persists the buffer to a small JSON file, and the
 * constructor loads it back in — so a restart (whatever triggers it) finds
 * the same mail still there.
 *
 * `FILE_PATH` is deliberately `.dev-mailbox.json`, a SIBLING of `src/`, not
 * inside it — `apps/api/tsconfig.json`'s `include` is `["src"]` only, so a
 * file here is outside the program `nest start --watch`'s `tsc` builder
 * compiles and therefore outside whatever it watches for a recompile. A
 * persistence file that itself lived inside the watch tree would make this
 * very fix the restart trigger the floor has been hunting. Gitignored
 * (`.gitignore`) for the same reason `.env` is: purely local, throwaway,
 * dev-machine state that has no business in a commit.
 */
const FILE_PATH = join(process.cwd(), '.dev-mailbox.json');

/**
 * DEV/TEST-ONLY email capture. When the email transport is the console logger
 * (development/test), outbound emails are also stored in a small ring buffer so
 * a developer or the integration suite can retrieve verification / reset tokens
 * the same way a user would read them from an inbox — without bypassing the real
 * token-generation and verification logic. Never enabled in production, and the
 * dev endpoint that reads this is not registered when NODE_ENV=production.
 *
 * Now also persisted to disk (MDF-728) so the buffer survives an API
 * restart — DEV/TEST ONLY, same `enabled` gate as recording itself. This
 * changes WHERE a captured mail survives, never WHEN one is captured:
 * `EmailService.sendDetailed` is still the one and only call site that
 * invokes `record()`, and still only when `result.delivered` is true (#693).
 */
@Injectable()
export class DevMailboxService {
  private readonly buffer: CapturedEmail[] = [];
  private readonly max = 200;
  private readonly enabled = process.env.NODE_ENV !== 'production';

  constructor() {
    if (!this.enabled) return;
    this.buffer.push(...this.loadFromDisk());
  }

  record(email: CapturedEmail): void {
    if (!this.enabled) return;
    this.buffer.push(email);
    if (this.buffer.length > this.max) this.buffer.shift();
    this.persistToDisk();
  }

  latestFor(to: string): CapturedEmail | undefined {
    const lower = to.toLowerCase();
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i]!.to.toLowerCase() === lower) return this.buffer[i];
    }
    return undefined;
  }

  /**
   * A corrupt or partially-written file (e.g. the process died mid-write on
   * a previous run) must never stop the API from booting — this is
   * throwaway dev convenience data, not a source of truth. Worst case is
   * the exact pre-MDF-728 behaviour: an empty mailbox.
   */
  private loadFromDisk(): CapturedEmail[] {
    try {
      if (!existsSync(FILE_PATH)) return [];
      const parsed = JSON.parse(readFileSync(FILE_PATH, 'utf8'));
      return Array.isArray(parsed) ? parsed.slice(-this.max) : [];
    } catch {
      return [];
    }
  }

  /**
   * Write-temp-then-rename, not a direct write — the same reason
   * hive-report.cjs verifies before publishing: a same-directory rename is
   * atomic, so a process killed mid-write leaves the OLD file intact
   * instead of a half-written one `loadFromDisk` would have to recover
   * from. A write failure (disk full, permissions) is swallowed, never
   * thrown — persistence is a nice-to-have on top of the in-memory buffer
   * this method's caller already updated, not a new way for a dev-only
   * code path to take down a request.
   */
  private persistToDisk(): void {
    try {
      const tmpPath = `${FILE_PATH}.${process.pid}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(this.buffer), 'utf8');
      renameSync(tmpPath, FILE_PATH);
    } catch {
      // Dev convenience only — see class comment.
    }
  }
}
