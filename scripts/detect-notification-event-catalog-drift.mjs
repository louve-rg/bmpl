#!/usr/bin/env node
/**
 * detect-notification-event-catalog-drift — does the notification event
 * catalog agree with what the code actually emits, in BOTH directions?
 * (BMPL-220)
 *
 * NOTIFICATION_EVENTS in packages/shared/src/notifications.ts is read as a
 * description of what this system emits, and BMPL-215's hand investigation
 * showed it is not one: 20 of 53 entries had zero call sites, and 9 codes
 * emitted in production were absent from the catalog. BMPL-219 fixed the
 * real defect underneath the biggest half of that (the whole delivery
 * lifecycle emitted no event code at all) and added the missing codes for
 * two verticals nobody had updated the catalog for. This script is the
 * mechanical, re-runnable version of that hand investigation — the same
 * move BMPL-211 made for a hand-typed count, and BMPL-218 made for a
 * document's citations.
 *
 * Design inherited, not re-litigated (settled by bmpl-docs before it hit its
 * token cap, accepted by god): a SEPARATE script rather than folded into
 * either existing checker. This is code-against-code (a TS array literal vs.
 * apps/api/src call sites), not doc-against-code like the other two; the
 * output is a two-directional per-entry reconciliation, not a scalar or a
 * per-citation list; and there is no parsing logic in common with a markdown
 * table walker. Coupling would cost readability for a shared-code saving
 * that does not exist.
 *
 *   node scripts/detect-notification-event-catalog-drift.mjs
 *   node scripts/detect-notification-event-catalog-drift.mjs --json
 *
 * Read-only, same boundary as the other three checkers in this directory: it
 * never edits the catalog or any call site, and never runs git. It reports;
 * a human decides whether an orphan is dead code or a product decision not
 * yet reached — see BMPL-219's own ruling that three orphans survive because
 * no separate driver-only notification channel exists, which is an
 * architecture fact, not a gap.
 *
 * WHAT THIS CHECKS:
 *   Every call to `.createInApp(`, `.notifyUsers(`, `.notifyAdmins(` or
 *   `.notify(` anywhere under apps/api/src (the last of these is
 *   DeliveryCoreService's own wrapper, which forwards to the real methods —
 *   its calls are real emission points and its own two internal forwarding
 *   calls inside delivery-core.service.ts appear in this scan too, since
 *   there is nothing in the source that marks them as different from any
 *   other call; they are expected to show up as PASS-THROUGH, not hidden).
 *   For each call, finds the `event:` property of its own top-level params
 *   object (never one nested inside, e.g., `data: { event: ... }`) and
 *   classifies it:
 *     - a single string literal ('X' or "X")            -> LITERAL
 *     - a ternary between exactly two string literals    -> TERNARY (both
 *       branches count as used — a ternary of two literals is fully
 *       enumerable, not actually unknown, and treating it as opaque would
 *       falsely orphan both codes; found live in this codebase twice:
 *       driver-jobs.service.ts's IN_TRANSIT/ARRIVING split, and
 *       messaging.service.ts's ATTACHMENT/RECEIVED split)
 *     - anything else (identifier, member access, `let` variable, etc.)      -> NON-LITERAL,
 *       always FLAGGED FOR MANUAL READ, never silently resolved or silently
 *       dropped — the same UNKNOWN-never-a-pass discipline as the other two
 *       checkers, applied here to a value instead of a citation. BMPL-215
 *       named three real ones (a ternary — now resolved above, see previous
 *       bullet — in messaging, a `let` in jobs, a pass-through in
 *       delivery-core); do not be surprised to see the delivery-core
 *       pass-through TWICE (notify() and notifyAdmins() each have their own
 *       `event: msg.event` line).
 *     - no `event:` key present at all                   -> NO-EVENT (the
 *       exact shape of the delivery-lifecycle bug BMPL-219 fixed; reported
 *       for visibility, not scored as a defect on its own — omitting event
 *       is syntactically legal and this script cannot tell an intentional
 *       omission from a regression without more context than it has)
 *   Then reconciles LITERAL and TERNARY codes against NOTIFICATION_EVENTS in
 *   both directions.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - Whether a NON-LITERAL event param's real runtime value is in the
 *     catalog or not — that requires resolving the expression, which this
 *     script refuses to do (see above). Each flagged non-literal DOES get a
 *     cheap, purely textual hint: any catalog entry name that appears as a
 *     substring of its raw source is named in the report, so a human can see
 *     the likely answer in the same second without the script pretending it
 *     verified anything.
 *   - Whether an emitted code that IS in the catalog is semantically the
 *     RIGHT code for what happened (that is BMPL-149/BMPL-214's territory —
 *     a reused-but-catalogued code is invisible to this script by design,
 *     because from here it looks exactly like correct usage).
 *   - Any call site outside apps/api/src, or any indirection layer other
 *     than DeliveryCoreService.notify/.notifyAdmins. A new wrapper introduced
 *     later needs this script updated to know about it, the same way BMPL-215
 *     had to be told about this one by hand.
 *   - Whether an orphaned catalog entry (zero LITERAL/TERNARY call sites) is
 *     dead code worth deleting — that is a product decision (BMPL-219: three
 *     orphans survive on purpose because the architecture fans one event to
 *     every audience already). This script never removes or suggests
 *     removing an entry.
 *
 * Exit codes:
 *   0  OK        every catalog entry has a call site (or a textual hint
 *                inside a flagged non-literal) and every literal/ternary
 *                emitted code is in the catalog
 *   1  DRIFT     at least one catalog entry has no call site and no textual
 *                hint, or at least one emitted code is absent from the
 *                catalog
 *   2  UNKNOWN   the catalog or the call-site tree could not be read/parsed
 *                at all — never folded into a pass
 * (A non-literal flag alone, with no drift on either side, does not raise
 * the exit code past 0 — it is a "go read this", not a confirmed defect.
 * The report still lists it, because a exit-0 reader should not think
 * nothing needed a human's attention.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'packages/shared/src/notifications.ts');
const SEARCH_ROOT = path.join(REPO_ROOT, 'apps/api/src');
const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.git']);
const CALL_METHODS = ['createInApp', 'notifyUsers', 'notifyAdmins', 'notify'];

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

/** Extracts `export const NOTIFICATION_EVENTS = [ ... ] as const;` string literals, in order, skipping comments. */
function parseCatalog(src) {
  const m = src.match(/NOTIFICATION_EVENTS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) return null;
  const body = m[1];
  const codes = [];
  const re = /'([A-Z0-9_]+)'/g;
  let mm;
  while ((mm = re.exec(body)) !== null) codes.push(mm[1]);
  return codes;
}

/**
 * From `start` (the index right after a call's opening `(`), finds the
 * matching closing `)`, skipping over string/template literal contents
 * (including `${...}` template substitutions, recursively) so a paren or
 * brace inside a title/body string can never corrupt the scan. Returns the
 * argument-list text and the index just past the matching `)`.
 */
function scanCallArgs(src, start) {
  let i = start;
  let parenDepth = 1;
  const stack = []; // 'squote' | 'dquote' | 'template' | 'template-expr' (each template-expr frame also carries its own braceDepth)
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
  return { text: src.slice(start), end: src.length }; // unterminated — best effort, reported as such by the caller finding no event key
}

/**
 * Finds the `event:` property belonging to the call's OWN top-level params
 * object (brace depth 1 within the argument-list text) — never one nested
 * inside a sibling property like `data: { event: ... }` (brace depth 2+).
 * Same string/template-aware scanning as scanCallArgs, applied to a flat
 * left-to-right walk so depth is always known at every position.
 */
function findTopLevelEventValue(argsText) {
  let i = 0;
  let braceDepth = 0;
  const stack = [];
  let eventValueStart = null;

  while (i < argsText.length) {
    const ch = argsText[i];
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
      if (ch === '$' && argsText[i + 1] === '{') {
        stack.push({ mode: 'template-expr', braceDepth: 1 });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (top && top.mode === 'template-expr') {
      if (ch === '{') top.braceDepth += 1;
      else if (ch === '}') {
        top.braceDepth -= 1;
        if (top.braceDepth === 0) stack.pop();
      } else if (ch === "'") stack.push('squote');
      else if (ch === '"') stack.push('dquote');
      else if (ch === '`') stack.push('template');
      i += 1;
      continue;
    }

    // Plain code.
    if (ch === '/' && argsText[i + 1] === '/') {
      const nl = argsText.indexOf('\n', i);
      i = nl === -1 ? argsText.length : nl + 1;
      continue;
    }
    if (ch === '/' && argsText[i + 1] === '*') {
      const close = argsText.indexOf('*/', i + 2);
      i = close === -1 ? argsText.length : close + 2;
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
    if (ch === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (braceDepth === 1 && eventValueStart != null) {
        return argsText.slice(eventValueStart, i).trim();
      }
      braceDepth -= 1;
      i += 1;
      continue;
    }
    if (ch === ',' && braceDepth === 1 && eventValueStart != null) {
      return argsText.slice(eventValueStart, i).trim();
    }
    if (braceDepth === 1 && eventValueStart == null && !/[\w.]/.test(argsText[i - 1] ?? '')) {
      const rest = argsText.slice(i);
      const wordMatch = /^event\b/.exec(rest);
      if (wordMatch) {
        const afterWord = rest.slice(wordMatch[0].length);
        const colonMatch = /^\s*:/.exec(afterWord);
        if (colonMatch) {
          i += wordMatch[0].length + colonMatch[0].length;
          eventValueStart = i;
          continue;
        }
        // ES6 shorthand (`{ event, title }`) — the property name IS the
        // value, a plain identifier reference exactly like `event: event`
        // would be, so it is always NON-LITERAL (a variable), same as any
        // other bare identifier.
        return 'event';
      }
    }
    i += 1;
  }
  return eventValueStart != null ? argsText.slice(eventValueStart).trim() : null;
}

const STRING_LITERAL_RE = /^(['"])([A-Za-z0-9_]+)\1$/;
const TERNARY_TWO_LITERALS_RE = /^.+?\?\s*(['"])([A-Za-z0-9_]+)\1\s*:\s*(['"])([A-Za-z0-9_]+)\3$/s;

function classifyEventValue(raw) {
  if (raw == null) return { kind: 'NO-EVENT' };
  const lit = STRING_LITERAL_RE.exec(raw);
  if (lit) return { kind: 'LITERAL', codes: [lit[2]] };
  const tern = TERNARY_TWO_LITERALS_RE.exec(raw);
  if (tern) return { kind: 'TERNARY', codes: [tern[2], tern[4]] };
  return { kind: 'NON-LITERAL', raw };
}

function findCallSites(files) {
  const callRe = new RegExp(`\\.(${CALL_METHODS.join('|')})\\(`, 'g');
  const sites = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(src)) !== null) {
      const openParen = m.index + m[0].length - 1;
      const { text, end } = scanCallArgs(src, openParen + 1);
      const lineNum = src.slice(0, m.index).split('\n').length;
      const raw = findTopLevelEventValue(text);
      const classified = classifyEventValue(raw);
      sites.push({
        file: rel(file),
        line: lineNum,
        method: m[1],
        ...classified,
        rawArgsPreview: text.slice(0, 200).replace(/\s+/g, ' ').trim(),
        ...(classified.kind === 'NON-LITERAL' ? { fileSrc: src } : {}),
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
    console.error(`UNKNOWN: could not find/parse NOTIFICATION_EVENTS in ${rel(CATALOG_PATH)}`);
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

  const literalSites = sites.filter((s) => s.kind === 'LITERAL' || s.kind === 'TERNARY');
  const nonLiteralSites = sites.filter((s) => s.kind === 'NON-LITERAL');
  const noEventSites = sites.filter((s) => s.kind === 'NO-EVENT');

  const usedCodes = new Map(); // code -> [{file,line,method}]
  for (const s of literalSites) {
    for (const code of s.codes) {
      const list = usedCodes.get(code) ?? [];
      list.push({ file: s.file, line: s.line, method: s.method });
      usedCodes.set(code, list);
    }
  }

  const catalogSet = new Set(catalog);
  const orphans = catalog.filter((c) => !usedCodes.has(c));
  const missing = [...usedCodes.keys()].filter((c) => !catalogSet.has(c));

  // A purely textual hint for an orphan, nothing more: does the catalog entry's
  // NAME appear inside a flagged non-literal call's own argument text (e.g. a
  // ternary branch this script's classifier didn't recognise), or anywhere else in
  // the SAME FILE as a flagged non-literal (e.g. a `let event = 'X'` declaration
  // elsewhere in the function, which is exactly the shape jobs.service.ts uses and
  // which this script deliberately does not trace — see the header). Either way
  // this is NEVER treated as verification, only ever printed alongside the orphan
  // so a human can see the likely answer without the script pretending to have
  // resolved anything.
  function textualHints(code) {
    const hints = [];
    for (const s of nonLiteralSites) {
      if (s.raw.includes(code)) hints.push(`${s.file}:${s.line} (in the call's own arguments)`);
      else if (s.fileSrc.includes(`'${code}'`) || s.fileSrc.includes(`"${code}"`)) hints.push(`${s.file}:${s.line} (elsewhere in the same file)`);
    }
    return hints;
  }

  const orphanDetails = orphans.map((code) => ({ code, hints: textualHints(code) }));
  const trueOrphans = orphanDetails.filter((o) => o.hints.length === 0);
  const hintedOrphans = orphanDetails.filter((o) => o.hints.length > 0);

  const drift = trueOrphans.length > 0 || missing.length > 0;
  const exitCode = drift ? 1 : 0;
  const status = drift ? 'DRIFT' : 'OK';

  const scope =
    `checks ONLY apps/api/src call sites against packages/shared/src/notifications.ts's NOTIFICATION_EVENTS — ` +
    `a code emitted elsewhere, a wrong-but-catalogued code, or a non-literal's real runtime value are all outside what an exit 0 here claims`;

  const summary = {
    catalogEntries: catalog.length,
    totalCallSites: sites.length,
    literalOrTernaryCallSites: literalSites.length,
    nonLiteralFlagged: nonLiteralSites.length,
    noEventCallSites: noEventSites.length,
    distinctUsedCodes: usedCodes.size,
    trueOrphans: trueOrphans.length,
    hintedOrphans: hintedOrphans.length,
    missingFromCatalog: missing.length,
  };

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          scope,
          summary,
          status,
          exitCode,
          trueOrphans: trueOrphans.map((o) => o.code),
          hintedOrphans,
          missingFromCatalog: missing.map((code) => ({ code, sites: sites.filter((s) => s.codes?.includes(code)) })),
          nonLiteralFlagged: nonLiteralSites.map(({ fileSrc, ...s }) => s),
          noEventCallSites: noEventSites,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('detect-notification-event-catalog-drift');
    console.log(scope + '\n');
    console.log(
      `catalog: ${summary.catalogEntries} entries | call sites: ${summary.totalCallSites} (${summary.literalOrTernaryCallSites} literal/ternary, ` +
        `${summary.nonLiteralFlagged} non-literal flagged, ${summary.noEventCallSites} pass no event) | distinct used codes: ${summary.distinctUsedCodes}\n`,
    );

    if (trueOrphans.length > 0) {
      console.log(`ORPHAN — catalog entry with no call site and no textual hint (${trueOrphans.length}):`);
      for (const o of trueOrphans) console.log(`  ${o.code}`);
      console.log('');
    }
    if (hintedOrphans.length > 0) {
      console.log(`ORPHAN-BUT-HINTED — no literal call site, but the name appears inside a flagged non-literal below; read it to confirm (${hintedOrphans.length}):`);
      for (const o of hintedOrphans) console.log(`  ${o.code}  (hinted at ${o.hints.join(', ')})`);
      console.log('');
    }
    if (missing.length > 0) {
      console.log(`MISSING-FROM-CATALOG — emitted as a literal/ternary but not in NOTIFICATION_EVENTS (${missing.length}):`);
      for (const code of missing) {
        const at = sites.filter((s) => s.codes?.includes(code)).map((s) => `${s.file}:${s.line}`);
        console.log(`  ${code}  (${at.join(', ')})`);
      }
      console.log('');
    }
    if (nonLiteralSites.length > 0) {
      console.log(`NON-LITERAL — event param is not a resolvable literal, FLAGGED FOR MANUAL READ, never silently passed (${nonLiteralSites.length}):`);
      for (const s of nonLiteralSites) {
        console.log(`  ${s.file}:${s.line} (.${s.method})  event: ${s.raw}`);
      }
      console.log('');
    }
    if (noEventSites.length > 0) {
      console.log(`NO-EVENT — call passes no event key at all, not scored as a defect on its own (${noEventSites.length}):`);
      for (const s of noEventSites) console.log(`  ${s.file}:${s.line} (.${s.method})`);
      console.log('');
    }

    console.log(`${status}: ${trueOrphans.length} orphan(s), ${hintedOrphans.length} hinted orphan(s), ${missing.length} missing-from-catalog code(s)`);
    console.log(`\nexit ${exitCode} (0 OK, 1 DRIFT — a true orphan or a missing code; a non-literal or hinted-orphan flag alone does not raise this)`);
  }

  process.exitCode = exitCode;
}

main();
