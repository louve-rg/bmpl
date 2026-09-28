#!/usr/bin/env node
/**
 * detect-permission-catalog-drift — does the admin permission catalog agree
 * with what the code actually enforces, in BOTH directions? (BMPL-304, the
 * permission analog of detect-notification-event-catalog-drift.mjs / BMPL-220)
 *
 * PERMISSIONS in packages/shared/src/permissions.ts is read as a description
 * of every admin capability this system can gate, and two hand investigations
 * months apart showed it is not one: BMPL-31 found `agencies.read` and
 * `agencies.moderate` catalogued with zero enforcement sites (no admin agency
 * endpoints exist at all — a missing surface, not a mis-guarded one), and
 * `logistics.verify` was found orphaned separately, the same family but a
 * different cause (BMPL-13: the permission is already CHOSEN for a PIN-override
 * feature that is itself blocked on an explicit human security decision, so
 * the code that would enforce it does not exist yet). Both were found by hand.
 * This script is the mechanical, re-runnable version of that hand
 * investigation — the same move BMPL-220 made for the notification catalog.
 *
 * Design inherited deliberately from BMPL-220 rather than folded into it:
 * a SEPARATE script, same shape (catalog array vs. source call sites, a
 * known-orphans baseline file, three-way OK/REVIEW/DRIFT status, the same
 * UNKNOWN-never-a-pass discipline for anything this script cannot resolve
 * statically). The two catalogs (notification event codes vs. admin
 * permission strings) are unrelated data with unrelated call-site shapes
 * (`event:` property inside an arbitrary object literal vs. a decorator's own
 * argument list) — sharing one script would mean branching internally on
 * which catalog it is, which is the coupling BMPL-220's own header already
 * rejected for a weaker reason (two markdown-table checkers). The two scripts
 * do duplicate the generic string/comment-aware paren scanner below; that is
 * the existing convention (every checker in this directory is self-contained
 * — only a checker's OWN baseline file is ever imported) and is deliberately
 * NOT extracted into a shared module by this change, for the same reason.
 *
 *   node scripts/detect-permission-catalog-drift.mjs
 *   node scripts/detect-permission-catalog-drift.mjs --json
 *
 * Read-only: it never edits the catalog, a controller, or any other file, and
 * never runs git. It reports; a human decides whether an orphan is a missing
 * surface (BMPL-31), a feature blocked on a product/security decision
 * (BMPL-13), or genuinely dead. CLASSIFY, DO NOT WIRE — this script never
 * adds an enforcement site, never removes a permission, and never suggests
 * building the admin surface for an orphan it finds.
 *
 * WHAT THIS CHECKS:
 *   Every `@RequirePermission(...)` decorator call anywhere under
 *   apps/api/src — the ONLY place a permission string is ever enforced in
 *   this codebase. (Confirmed before writing this: `hasPermission()` and
 *   `hasAllPermissions()` in packages/authorization/src/index.ts are pure
 *   functions consumed solely by the guard that reads this decorator's own
 *   metadata — nothing in apps/api/src calls either of them directly with a
 *   permission string of its own. If that ever changes, this script needs
 *   telling, the same way BMPL-215 had to tell the notification checker about
 *   DeliveryCoreService's wrapper.) For each call, the full argument list is
 *   split on top-level commas (a decorator may require ALL of several
 *   permissions — apps/api/CLAUDE.md §1) and each argument classified:
 *     - a string literal ('x.y' or "x.y")   -> LITERAL, contributes that code
 *     - anything else (identifier, member access, spread, template literal,
 *       computed expression, ...)            -> NON-LITERAL, FLAGGED FOR
 *       MANUAL READ, never silently resolved or silently dropped — the same
 *       discipline BMPL-234 hardened on the notification checker, carried
 *       across deliberately per this card's own dispatch. Confirmed empirically
 *       before writing this script that EVERY current call site in the tree
 *       passes only literal strings (199 call sites, zero non-literal, zero
 *       multi-argument) — so this path is exercised by no real code today,
 *       which is exactly why it must still exist and still refuse to guess:
 *       the day someone composes a permission dynamically, silence here would
 *       be the same "wrong, unflagged answer" BMPL-234 named as worse than an
 *       admitted gap.
 *   Then reconciles the LITERAL codes against PERMISSIONS in both directions.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - Whether a NON-LITERAL argument's real runtime value is in the catalog —
 *     resolving it is exactly what this script refuses to do (see above). As
 *     with the notification checker, each orphan gets a cheap textual hint
 *     (does its name appear inside a flagged non-literal call, or elsewhere in
 *     the same file) — never treated as verification, only ever printed
 *     alongside so a human sees the likely answer without the script
 *     pretending to have resolved anything.
 *   - Whether an enforced-and-catalogued permission is semantically the RIGHT
 *     one for the route it guards (e.g. a route that should require
 *     `orders.manage` but only asks for `orders.read`) — invisible to this
 *     script by design, because from here it looks exactly like correct usage.
 *   - Any call site outside apps/api/src, or any indirection layer other than
 *     the decorator itself (see above). A future wrapper needs this script
 *     told about it by hand.
 *   - Whether an orphaned catalog entry is dead code worth deleting, or which
 *     bundle a permission should belong to — both are product decisions
 *     (BMPL-31, BMPL-13). This script never removes or suggests removing an
 *     entry, and never touches PERMISSION_BUNDLES.
 *
 * Exit codes:
 * A NEW orphan is not the same claim as a KNOWN one, so this script ships
 * with a baseline from day one (scripts/permission-catalog-known-orphans.mjs)
 * rather than discovering the BMPL-31/BMPL-13 orphans as "new" on its very
 * first run — reporting an already-held, already-explained orphan as fresh
 * drift on every run is the identical "always-red gets muted" trap the
 * notification checker's own baseline exists to avoid. A baselined orphan is
 * still PRINTED every run (the known state stays visible) but does not raise
 * the exit code; a NEW orphan — one the baseline does not name — still does.
 * Every baseline entry must carry a real, non-empty reason, or this script
 * treats THAT as its own defect. A baseline entry for a code that is no
 * longer orphaned is reported as STALE — good news, not a failure, but never
 * silently unmentioned.
 *
 *   0  OK/REVIEW  every catalog entry has an enforcement site, a textual hint,
 *                 or a baseline reason, and every literal enforced code is in
 *                 the catalog (see STATUS WORD below for the OK/REVIEW split)
 *   1  DRIFT      at least one catalog entry has no enforcement site, no
 *                 textual hint and no baseline reason; at least one literal
 *                 enforced code is absent from the catalog; or a baseline
 *                 entry has an empty reason
 *   2  UNKNOWN    the catalog or the call-site tree could not be read/parsed
 *                 at all — never folded into a pass
 *
 * STATUS WORD vs. EXIT CODE (BMPL-234's lesson, carried across on purpose):
 * exit 0 covers two different situations, and printing the same bare "OK" for
 * both is the exact defect BMPL-234 fixed on the notification checker. A
 * catalog entry with only a hinted-but-non-literal enforcement site is
 * UNVERIFIED, not VERIFIED — this script never resolved it, it only noticed a
 * name match nearby. So the printed/JSON `status` has three values:
 *   OK       clean, and every orphan is either baselined or has zero hints
 *            needed — nothing to read
 *   REVIEW   still exit 0 — no NEW orphan, no missing code, no empty-reason
 *            baseline entry — but at least one ORPHAN-BUT-HINTED exists: a
 *            code this script could not verify, only guess about. Distinct
 *            from OK on purpose, and still exit 0 on purpose: failing the
 *            build on a genuinely ambiguous case is the same "always-red gets
 *            muted" trap the baseline exists to avoid, one level up.
 *   DRIFT    exit 1, unchanged
 * `needsReview` (JSON: a boolean) is the same fact machine-readable.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_ORPHANS } from './permission-catalog-known-orphans.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'packages/shared/src/permissions.ts');
const SEARCH_ROOT = path.join(REPO_ROOT, 'apps/api/src');
const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.git']);
const DECORATOR = 'RequirePermission';

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

function walkTsFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Extracts `export const PERMISSIONS = [ ... ] as const;` string literals, in order. */
function parseCatalog(src) {
  const m = src.match(/PERMISSIONS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) return null;
  const body = m[1];
  const codes = [];
  const re = /'([a-z0-9_]+\.[a-z0-9_]+)'/g;
  let mm;
  while ((mm = re.exec(body)) !== null) codes.push(mm[1]);
  return codes;
}

/**
 * From `start` (the index right after a call's opening `(`), finds the
 * matching closing `)`, skipping over string/template literal contents
 * (including `${...}` template substitutions, recursively) so a paren or
 * brace inside a string can never corrupt the scan. Returns the argument-list
 * text and the index just past the matching `)`. Identical logic to the
 * notification checker's own scanner (see this file's header for why it is
 * duplicated rather than shared) — decorator arguments are simpler in
 * practice than a notification call's object literal, but nothing about a
 * TypeScript decorator's grammar guarantees that, so this does not assume it.
 */
function scanCallArgs(src, start) {
  let i = start;
  let parenDepth = 1;
  const stack = [];
  while (i < src.length) {
    const ch = src[i];
    const top = stack[stack.length - 1];

    if (top === 'squote' || top === 'dquote') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if ((top === 'squote' && ch === "'") || (top === 'dquote' && ch === '"')) stack.pop();
      i += 1;
      continue;
    }
    if (top === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        i += 1;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        stack.push({ mode: 'template-expr', braceDepth: 1 });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (top && top.mode === 'template-expr') {
      if (ch === '{') {
        top.braceDepth += 1;
        i += 1;
        continue;
      }
      if (ch === '}') {
        top.braceDepth -= 1;
        if (top.braceDepth === 0) {
          stack.pop();
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }
      if (ch === "'") {
        stack.push('squote');
        i += 1;
        continue;
      }
      if (ch === '"') {
        stack.push('dquote');
        i += 1;
        continue;
      }
      if (ch === '`') {
        stack.push('template');
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    // Plain code.
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? src.length : close + 2;
      continue;
    }
    if (ch === "'") {
      stack.push('squote');
      i += 1;
      continue;
    }
    if (ch === '"') {
      stack.push('dquote');
      i += 1;
      continue;
    }
    if (ch === '`') {
      stack.push('template');
      i += 1;
      continue;
    }
    if (ch === '(') {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        return { text: src.slice(start, i), end: i + 1 };
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return { text: src.slice(start), end: src.length };
}

/**
 * Splits a decorator's argument-list text on top-level commas (outside any
 * quote or template), so `@RequirePermission('a.b', 'c.d')` yields two
 * arguments rather than being treated as one opaque blob.
 */
function splitTopLevelArgs(text) {
  const parts = [];
  let cur = '';
  let i = 0;
  const stack = [];
  while (i < text.length) {
    const ch = text[i];
    const top = stack[stack.length - 1];
    if (top === 'squote' || top === 'dquote') {
      cur += ch;
      if (ch === '\\') {
        cur += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if ((top === 'squote' && ch === "'") || (top === 'dquote' && ch === '"')) stack.pop();
      i += 1;
      continue;
    }
    if (top === 'template') {
      cur += ch;
      if (ch === '\\') {
        cur += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '`') stack.pop();
      i += 1;
      continue;
    }
    if (ch === "'") {
      stack.push('squote');
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      stack.push('dquote');
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '`') {
      stack.push('template');
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === ',' && stack.length === 0) {
      parts.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.trim().length > 0 || parts.length > 0) parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

const STRING_LITERAL_RE = /^(['"])([a-z0-9_]+\.[a-z0-9_]+)\1$/;

function classifyArg(raw) {
  const lit = STRING_LITERAL_RE.exec(raw);
  if (lit) return { kind: 'LITERAL', code: lit[2] };
  return { kind: 'NON-LITERAL', raw };
}

/**
 * Finds every `//...` and `/*...*​/` comment range in `src` so a call-site
 * match that merely APPEARS inside a comment — e.g. a JSDoc line that
 * mentions `@RequirePermission(...)` by name to describe what a class does,
 * without actually calling it — can be excluded. Found live in this exact
 * codebase while building this script: auth/guards.ts:109 has a one-line
 * doc comment naming the decorator, which a naive text search would have
 * reported as a 200th call site with a nonsense "..." argument. String and
 * template literal contents are excluded from comment detection the same
 * way the other scanners exclude code from string detection — a `//` or
 * `/*` inside a quoted string is not a comment.
 */
function findCommentRanges(src) {
  const ranges = [];
  let i = 0;
  const stack = [];
  while (i < src.length) {
    const ch = src[i];
    const top = stack[stack.length - 1];
    if (top === 'squote' || top === 'dquote') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if ((top === 'squote' && ch === "'") || (top === 'dquote' && ch === '"')) stack.pop();
      i += 1;
      continue;
    }
    if (top === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') stack.pop();
      i += 1;
      continue;
    }
    if (ch === "'") {
      stack.push('squote');
      i += 1;
      continue;
    }
    if (ch === '"') {
      stack.push('dquote');
      i += 1;
      continue;
    }
    if (ch === '`') {
      stack.push('template');
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const start = i;
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      ranges.push([start, end]);
      i = end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const start = i;
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      ranges.push([start, end]);
      i = end;
      continue;
    }
    i += 1;
  }
  return ranges;
}

function isInsideAny(ranges, index) {
  return ranges.some(([s, e]) => index >= s && index < e);
}

function findCallSites(files) {
  const callRe = new RegExp(`@${DECORATOR}\\(`, 'g');
  const sites = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const commentRanges = findCommentRanges(src);
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(src)) !== null) {
      if (isInsideAny(commentRanges, m.index)) continue;
      const openParen = m.index + m[0].length - 1;
      const { text } = scanCallArgs(src, openParen + 1);
      const lineNum = src.slice(0, m.index).split('\n').length;
      const rawArgs = splitTopLevelArgs(text);
      const classified = rawArgs.length === 0 ? [{ kind: 'NO-ARGS' }] : rawArgs.map(classifyArg);
      sites.push({
        file: rel(file),
        line: lineNum,
        args: classified,
        rawArgsPreview: text.slice(0, 200).replace(/\s+/g, ' ').trim(),
        fileSrc: src,
      });
    }
  }
  return sites;
}

function main() {
  let catalogSrc, catalog;
  try {
    catalogSrc = readFileSync(CATALOG_PATH, 'utf8');
    catalog = parseCatalog(catalogSrc);
  } catch {
    catalog = null;
  }
  if (!catalog) {
    console.error(`UNKNOWN: could not find/parse PERMISSIONS in ${rel(CATALOG_PATH)}`);
    process.exitCode = 2;
    return;
  }

  let files;
  try {
    files = walkTsFiles(SEARCH_ROOT);
    if (files.length === 0) throw new Error('empty');
  } catch {
    console.error(`UNKNOWN: could not walk ${rel(SEARCH_ROOT)} for .ts files`);
    process.exitCode = 2;
    return;
  }

  const sites = findCallSites(files);

  const usedCodes = new Map(); // code -> [{file,line}]
  const nonLiteralSites = []; // {file,line,raw,fileSrc}
  const noArgsSites = []; // {file,line}

  for (const s of sites) {
    for (const a of s.args) {
      if (a.kind === 'LITERAL') {
        const list = usedCodes.get(a.code) ?? [];
        list.push({ file: s.file, line: s.line });
        usedCodes.set(a.code, list);
      } else if (a.kind === 'NON-LITERAL') {
        nonLiteralSites.push({ file: s.file, line: s.line, raw: a.raw, fileSrc: s.fileSrc });
      } else if (a.kind === 'NO-ARGS') {
        noArgsSites.push({ file: s.file, line: s.line });
      }
    }
  }

  const catalogSet = new Set(catalog);
  const orphans = catalog.filter((c) => !usedCodes.has(c));
  const missing = [...usedCodes.keys()].filter((c) => !catalogSet.has(c));

  // A purely textual hint, never verification: does the orphan's exact string
  // appear inside a flagged non-literal call's own argument text, or anywhere
  // else in the SAME FILE as a flagged non-literal call.
  function textualHints(code) {
    const hints = [];
    for (const s of nonLiteralSites) {
      if (s.raw.includes(code)) hints.push(`${s.file}:${s.line} (in the call's own arguments)`);
      else if (s.fileSrc.includes(`'${code}'`) || s.fileSrc.includes(`"${code}"`)) hints.push(`${s.file}:${s.line} (elsewhere in the same file)`);
    }
    return hints;
  }

  const orphanDetails = orphans.map((code) => ({ code, hints: textualHints(code) }));
  const unhintedOrphans = orphanDetails.filter((o) => o.hints.length === 0);
  const hintedOrphans = orphanDetails.filter((o) => o.hints.length > 0);

  const baselineReasonMissing = Object.entries(KNOWN_ORPHANS)
    .filter(([, reason]) => !reason || !reason.trim())
    .map(([code]) => code);
  const validBaseline = new Set(Object.entries(KNOWN_ORPHANS).filter(([, r]) => r && r.trim()).map(([c]) => c));

  const newOrphans = unhintedOrphans.filter((o) => !validBaseline.has(o.code));
  const baselineAcknowledged = unhintedOrphans
    .filter((o) => validBaseline.has(o.code))
    .map((o) => ({ ...o, reason: KNOWN_ORPHANS[o.code] }));

  const unhintedOrphanCodes = new Set(unhintedOrphans.map((o) => o.code));
  const staleBaselineEntries = Object.keys(KNOWN_ORPHANS).filter((code) => !unhintedOrphanCodes.has(code));

  const drift = newOrphans.length > 0 || missing.length > 0 || baselineReasonMissing.length > 0;
  const exitCode = drift ? 1 : 0;
  const needsReview = hintedOrphans.length > 0;
  const status = drift ? 'DRIFT' : needsReview ? 'REVIEW' : 'OK';

  const scope =
    `checks ONLY apps/api/src @${DECORATOR}(...) call sites against packages/shared/src/permissions.ts's PERMISSIONS — ` +
    `a permission checked elsewhere, a wrong-but-catalogued permission on a route, or a non-literal's real runtime value are all outside what an exit 0 here claims. ` +
    `An orphan named in scripts/permission-catalog-known-orphans.mjs is reported but does not fail this check — see that file for why each one is accepted.`;

  const summary = {
    catalogEntries: catalog.length,
    totalCallSites: sites.length,
    literalArgs: [...usedCodes.values()].reduce((n, l) => n + l.length, 0),
    nonLiteralFlagged: nonLiteralSites.length,
    noArgsCallSites: noArgsSites.length,
    distinctUsedCodes: usedCodes.size,
    newOrphans: newOrphans.length,
    baselineAcknowledgedOrphans: baselineAcknowledged.length,
    hintedOrphans: hintedOrphans.length,
    staleBaselineEntries: staleBaselineEntries.length,
    baselineReasonMissing: baselineReasonMissing.length,
    missingFromCatalog: missing.length,
  };

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          scope,
          summary,
          status,
          needsReview,
          exitCode,
          newOrphans: newOrphans.map((o) => o.code),
          baselineAcknowledgedOrphans: baselineAcknowledged,
          hintedOrphans,
          staleBaselineEntries,
          baselineReasonMissing,
          missingFromCatalog: missing.map((code) => ({ code, sites: usedCodes.get(code) })),
          nonLiteralFlagged: nonLiteralSites.map(({ fileSrc, ...s }) => s),
          noArgsCallSites: noArgsSites,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('detect-permission-catalog-drift');
    console.log(scope + '\n');
    console.log(
      `catalog: ${summary.catalogEntries} entries | call sites: ${summary.totalCallSites} (${summary.literalArgs} literal args, ` +
        `${summary.nonLiteralFlagged} non-literal flagged, ${summary.noArgsCallSites} pass no args) | distinct enforced codes: ${summary.distinctUsedCodes}\n`,
    );

    if (newOrphans.length > 0) {
      console.log(`NEW ORPHAN — catalog entry with no enforcement site, no textual hint, and not in the known-orphans baseline (${newOrphans.length}):`);
      for (const o of newOrphans) console.log(`  ${o.code}`);
      console.log('');
    }
    if (baselineAcknowledged.length > 0) {
      console.log(`KNOWN ORPHAN — no enforcement site, but acknowledged in scripts/permission-catalog-known-orphans.mjs, not scored (${baselineAcknowledged.length}):`);
      for (const o of baselineAcknowledged) console.log(`  ${o.code}  — ${o.reason}`);
      console.log('');
    }
    if (hintedOrphans.length > 0) {
      console.log(
        `ORPHAN-BUT-HINTED — UNVERIFIED, not the same claim as a confirmed use or an accepted known orphan: no literal enforcement site, ` +
          `only a name match inside a flagged non-literal below; read it to confirm (${hintedOrphans.length}):`,
      );
      for (const o of hintedOrphans) console.log(`  ${o.code}  (hinted at ${o.hints.join(', ')})`);
      console.log('');
    }
    if (staleBaselineEntries.length > 0) {
      console.log(`STALE BASELINE ENTRY — listed as a known orphan but no longer one; consider removing it from the baseline file (${staleBaselineEntries.length}):`);
      for (const code of staleBaselineEntries) console.log(`  ${code}`);
      console.log('');
    }
    if (baselineReasonMissing.length > 0) {
      console.log(`BASELINE DEFECT — accepted with an empty reason, which does not count as accepted (${baselineReasonMissing.length}):`);
      for (const code of baselineReasonMissing) console.log(`  ${code}`);
      console.log('');
    }
    if (missing.length > 0) {
      console.log(`MISSING-FROM-CATALOG — enforced as a literal but not in PERMISSIONS (${missing.length}):`);
      for (const code of missing) {
        const at = (usedCodes.get(code) ?? []).map((s) => `${s.file}:${s.line}`);
        console.log(`  ${code}  (${at.join(', ')})`);
      }
      console.log('');
    }
    if (nonLiteralSites.length > 0) {
      console.log(`NON-LITERAL — @${DECORATOR} argument is not a resolvable literal, FLAGGED FOR MANUAL READ, never silently passed (${nonLiteralSites.length}):`);
      for (const s of nonLiteralSites) {
        console.log(`  ${s.file}:${s.line}  arg: ${s.raw}`);
      }
      console.log('');
    }
    if (noArgsSites.length > 0) {
      console.log(`NO-ARGS — @${DECORATOR}() called with no arguments at all, not scored as a defect on its own (${noArgsSites.length}):`);
      for (const s of noArgsSites) console.log(`  ${s.file}:${s.line}`);
      console.log('');
    }

    console.log(
      `${status}: ${newOrphans.length} new orphan(s), ${baselineAcknowledged.length} known orphan(s), ${hintedOrphans.length} hinted orphan(s), ` +
        `${staleBaselineEntries.length} stale baseline entr${staleBaselineEntries.length === 1 ? 'y' : 'ies'}, ${baselineReasonMissing.length} baseline defect(s), ` +
        `${missing.length} missing-from-catalog code(s)`,
    );
    if (needsReview) {
      console.log(
        `REVIEW means exit 0 is NOT the same claim as OK: ${hintedOrphans.length} code(s) above are UNVERIFIED (a name match, not a resolved call site) — ` +
          `read the ORPHAN-BUT-HINTED entries before treating this run as clean.`,
      );
    }
    console.log(
      `\nexit ${exitCode} (0 OK/REVIEW, 1 DRIFT — a NEW orphan, a missing code, or a baseline entry with no reason; a known/hinted orphan, a stale baseline ` +
        `note, or a non-literal flag alone does not raise this. REVIEW vs. OK is the status word above, not the exit code: REVIEW means at least one code ` +
        `is UNVERIFIED, not confirmed either way — see BMPL-234)`,
    );
  }

  process.exitCode = exitCode;
}

main();
