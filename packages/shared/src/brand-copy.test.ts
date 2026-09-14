import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * The abbreviation is BML, and the customer-facing spelling is "Inquire".
 *
 * Both were swept once. Without something watching, the next person to write a
 * page reaches for whichever they saw last, and the product goes back to being
 * spelled two ways — which is how it got here.
 *
 * This checks COPY, and only copy. Two things are deliberately out of scope,
 * because changing them would break something real to settle a spelling:
 *
 *  - Identifiers. The real-estate module's own vocabulary is "enquiry" — the
 *    Prisma model, the API fields, the service, the route segments. Renaming
 *    those renames stored data and the public API.
 *  - Comments. Developer text is not customer-facing, and rewriting it would be
 *    diff noise in files nobody is reading for the brand.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['apps/web', 'apps/admin', 'apps/mobile', 'apps/api/src', 'packages/shared/src', 'packages/validation/src'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', 'build', 'coverage']);

/** Identifiers, not branding. Renaming these renames data, not words. */
const ALLOWED_BMPL = [
  /BMPL_HUB/, // persisted HUB_TYPES enum value
  /X-BMPL-/, // HTTP response headers read by deployment tooling
  /BMPL_BUILD_COMMIT/, // env var wired into Vercel; the /health endpoints and deploy-status read it
  /BMPL-THEME/, // a real filename on disk
  // Ticket ids (BMPL-112, BMPL-128…) are identifiers into the tracker, not
  // product copy — the same convention docs/ already follows. Without this
  // line, every "fixed in BMPL-nnn" code comment is an offender, and thirty
  // of them accumulated unseen because CI does not run this package's tests.
  /BMPL-\d/,
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const root of ROOTS) walk(join(REPO, root));
  return out;
}

const FILES = sourceFiles();
const show = (file: string, i: number, line: string) =>
  `${relative(REPO, file).split(sep).join('/')}:${i + 1}  ${line.trim().slice(0, 100)}`;

/** A comment line carries developer text, not product copy. */
function isComment(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

describe('brand copy', () => {
  it('finds source to check, so a broken path cannot make this pass vacuously', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('says BML, not BMPL', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!line.includes('BMPL')) return;
          if (ALLOWED_BMPL.some((re) => re.test(line))) return;
          offenders.push(show(file, i, line));
        });
    }
    expect(offenders, `Use BML in copy a person reads:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('spells it "Inquire", not "Inquire", in copy', () => {
    const word = /(?<![A-Za-z])([Ee])nquir(y|ies|e|ed|es|ing|er|ers)?(?![A-Za-z])/g;
    // Punctuation that means the match is part of an expression rather than a
    // sentence: a leading dot or quote is a property or key, a trailing dot,
    // bracket, `?` or `:` is a member, call or type position, and a slash on
    // either side is a route segment that exists as a directory on disk.
    const CODE_BEFORE = /[./'"`]$/;
    const CODE_AFTER = /^[.(?:/'"`\]>=,;]/;

    const offenders: string[] = [];
    for (const file of FILES) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('import ') || isComment(trimmed)) return;
          for (const m of line.matchAll(word)) {
            const at = m.index ?? 0;
            const before = line.slice(Math.max(0, at - 1), at);
            // Look past spaces: `const enquiry =` and `: enquiry ?` are both a
            // bare variable, and the character that gives them away is the next
            // non-space one, not the space itself.
            const after = line.slice(at + m[0].length).replace(/^\s+/, '').slice(0, 1);
            // Capitalisation separates a label from a key. `'Enquiries'` is a
            // button and `'enquirer'` is an object key, and both are fully
            // quoted — only the case tells them apart.
            const capitalised = m[1] === 'E';
            const isCode = capitalised ? before === '.' : CODE_BEFORE.test(before) || CODE_AFTER.test(after);
            if (isCode) continue;
            offenders.push(show(file, i, line));
            break;
          }
        });
    }
    expect(offenders, `Use "Inquire" in copy a person reads:\n${offenders.join('\n')}`).toEqual([]);
  });
});
