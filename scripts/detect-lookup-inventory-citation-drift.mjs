#!/usr/bin/env node
/**
 * detect-lookup-inventory-citation-drift — do this doc's file:line citations
 * still point at what they claim? (BMPL-211 follow-up)
 *
 * docs/quality/LOOKUP-DATA-INVENTORY.md cites a source line for almost every
 * row — `jobs.ts:7`, `(schema:2372)`, `schema.prisma:922`, `roles.ts:53-145`.
 * One of those citations was checked here already (BMPL-211: the enum-count
 * row) and turned out wrong for 55 days. Before sweeping the rest, a
 * throwaway script checked all of them by hand and found the OTHER citations
 * currently accurate — so this is not "line numbers rot", it's "that one row
 * was never revisited". This script is the permanent version of that
 * throwaway check: it turns every citation in the document into a checked
 * fact instead of a hand-typed one, the same move BMPL-211 made for the
 * count next to it.
 *
 *   node scripts/detect-lookup-inventory-citation-drift.mjs
 *   node scripts/detect-lookup-inventory-citation-drift.mjs --json
 *
 * Read-only, same boundary as detect-tracked-deletions.mjs and
 * detect-notification-category-count-drift.mjs: it never edits the document
 * or any source file, and never runs git. It reports; a human edits.
 *
 * WHY A SECOND SCRIPT RATHER THAN FOLDING INTO detect-notification-category-
 * count-drift.mjs: that one checks a single fact (does this count match that
 * enum). This one walks an entire document and produces a list of findings
 * with several distinct "cannot check" reasons. Different shapes of output,
 * different exit-code semantics (a scalar match/mismatch vs. an aggregate
 * over N citations) — forcing them into one script would make the simpler
 * one harder to read for no shared code worth the coupling. They share a
 * pattern (derive, don't transcribe), not an implementation.
 *
 * WHAT THIS CHECKS:
 *   Every citation of the shape:
 *     - `` `file.ts:N` `` or `` `file.ts:N-M` `` or `` `file.ts:N,M,K` ``
 *       (backtick-wrapped file + line spec, any file ending .ts or .prisma)
 *     - `schema:N` (bare, no backticks — always packages/database/prisma/schema.prisma)
 *     - `` `Symbol` (N) `` (backtick symbol immediately followed by a bare
 *       parenthetical integer with no unit word — also schema.prisma)
 *     - `(N-M)` (a bare parenthetical range with no preceding symbol — schema.prisma)
 *   For each: resolves the target file (searching packages/shared/src,
 *   packages/database/prisma and apps/api/src, recursively — the last of
 *   these is the exact gap the throwaway script left open, since it only
 *   looked in the first two and missed two controller citations entirely),
 *   and — when a single specific line (not a range/list) has a resolvable
 *   symbol immediately before it in the same table cell — checks that the
 *   symbol is actually declared there, or names where it actually is.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - A citation that is a RANGE or a comma-separated list of lines (e.g.
 *     `roles.ts:53-145`, `reviews.ts:6,9,12`) is never symbol-checked — a
 *     span or a list doesn't name one declaration to verify against. These
 *     get the weaker check only: does the file exist, and does every cited
 *     line number actually fit inside it. That is real signal (a citation
 *     whose end line no longer exists in the file HAS drifted) even without
 *     naming the right symbol.
 *   - A citation with no resolvable symbol at all (nothing in backticks
 *     immediately before it that is a plain identifier) gets the same
 *     weaker existence/bounds check, for the same reason.
 *   - Any document other than LOOKUP-DATA-INVENTORY.md. Whether this
 *     generalises to other documents with citations is an open question,
 *     not answered by writing this.
 *   - Whether the CONTENT at a correctly-cited line is semantically right
 *     (e.g. whether `EmploymentType` still has the right VALUES) — only
 *     whether the named thing still lives where the document says it does.
 *
 * THE COVERAGE NET (added after the schema.prisma:N-outside-backticks format fooled this
 * script's own first version): the four recognizers above can only report on a citation
 * they matched. One they never learned to recognise is invisible by construction — no
 * different, from inside the tool, than a line with no citation at all. After masking
 * every real match, a second pass scans what's LEFT for the same fingerprint every real
 * citation in this document has (a digit run near a backtick/`.ts`/`.prisma`/the words
 * "schema" or "line") and reports anything it still finds as UNRECOGNISED-CANDIDATE — not
 * a confirmed drift, but never folded into a pass either. It does not parse or resolve
 * the candidate; it only refuses to stay silent about it. It cannot catch a citation with
 * no digit/keyword fingerprint at all (plain prose has nothing to grep for) — meaningfully
 * narrower than complete, which is the honest limit of any regex-based net.
 *
 * Exit codes:
 *   0  OK        no citation is confirmed drifted or provably out of bounds, and the
 *                coverage net found nothing unclaimed; every unresolved-symbol case at
 *                least passed the weaker existence/bounds check
 *   1  UNKNOWN   nothing confirmed wrong, but at least one citation's FILE could not be
 *                found or resolved unambiguously, OR the coverage net flagged an
 *                unrecognised candidate — both are a real "cannot verify", never folded
 *                into a pass
 *   2  DRIFTED   at least one citation is confirmed wrong: a named symbol is
 *                declared somewhere else (or nowhere), or a cited line/range
 *                no longer fits inside the file at all
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = path.join(REPO_ROOT, 'docs/quality/LOOKUP-DATA-INVENTORY.md');
const SCHEMA_PATH = path.join(REPO_ROOT, 'packages/database/prisma/schema.prisma');
const SEARCH_ROOTS = ['packages/shared/src', 'packages/database/prisma', 'apps/api/src'].map((p) => path.join(REPO_ROOT, p));
const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.git']);

/** basename -> full path[]; more than one entry means AMBIGUOUS, not a guess. */
function buildFileIndex(roots) {
  const index = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.prisma'))) {
        const list = index.get(e.name) ?? [];
        list.push(full);
        index.set(e.name, list);
      }
    }
  };
  for (const r of roots) walk(r);
  return index;
}

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

/** Extracts every citation from one doc line, masking each match so later passes don't re-find it. */
function extractCitations(line) {
  const citations = [];
  let masked = line;

  const mask = (start, end) => {
    masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end);
  };

  // 1) `` `file.(ts|prisma):LINESPEC` `` — LINESPEC is digits, commas, dashes
  {
    const re = /`([\w.-]+\.(?:ts|prisma)):([\d,-]+)`/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      citations.push({ index: m.index, file: m[1], lineSpec: m[2], kind: m[1] === 'schema.prisma' ? 'schema' : 'ts' });
      mask(m.index, m.index + m[0].length);
    }
  }
  // 2) bare `schema:N` or `schema.prisma:N` — no backticks, always schema.prisma.
  // Two literal spellings occur in this doc ("schema:36" and "schema.prisma:922") and
  // neither is inside backticks on its own, so pattern 1 above never sees either.
  {
    const re = /\bschema(?:\.prisma)?:(\d+)\b/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      citations.push({ index: m.index, file: 'schema.prisma', lineSpec: m[1], kind: 'schema' });
      mask(m.index, m.index + m[0].length);
    }
  }
  // 3) `` `Symbol` (N) `` — bare pure-digit parenthetical right after a backtick identifier — schema.prisma
  {
    const re = /`([A-Za-z_][A-Za-z0-9_]*)`\s*\((\d+)\)/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      const parenStart = m.index + m[0].indexOf('(');
      citations.push({ index: parenStart, file: 'schema.prisma', lineSpec: m[2], kind: 'schema' });
      mask(m.index, m.index + m[0].length);
    }
  }
  // 4) bare `(N-M)` range with nothing checkable before it — schema.prisma
  {
    const re = /\((\d+)-(\d+)\)/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      citations.push({ index: m.index, file: 'schema.prisma', lineSpec: `${m[1]}-${m[2]}`, kind: 'schema' });
      mask(m.index, m.index + m[0].length);
    }
  }

  // Nearest preceding backtick-wrapped plain identifier, per citation, from the ORIGINAL
  // (unmasked) line — but never crossing a `|` table-cell boundary. Without that limit, a
  // citation in one cell can wrongly inherit a symbol name from an EARLIER cell in the same
  // row (e.g. a Prisma model name from the "source" cell bleeding into an unrelated citation
  // in the "public API" cell three columns later) — found by inspection, not by assumption.
  const idRe = /`([A-Za-z_][A-Za-z0-9_]*)`/g;
  for (const c of citations) {
    const before = line.slice(0, c.index);
    const cellStart = before.lastIndexOf('|') + 1;
    const cellBefore = before.slice(cellStart);
    let last = null;
    let m;
    idRe.lastIndex = 0;
    while ((m = idRe.exec(cellBefore)) !== null) last = m[1];
    c.symbol = last;
  }

  return { citations: citations.sort((a, b) => a.index - b.index), masked };
}

/**
 * The coverage net (BMPL-211, third missed format): a citation the four strict patterns
 * above never learned to recognise is invisible to them by construction — masked.exec()
 * simply never matches, which looks identical to "no citation here". This scans what is
 * LEFT after every real match has been masked out, looking for the same fingerprint every
 * citation in this document actually has: a run of 2+ digits sitting close to a backtick,
 * a `.ts`/`.prisma` extension, or the word "schema"/"line". A match here does not mean a
 * citation was missed — it means something LOOKS like one and no recognizer claimed it,
 * which is exactly the shape of thing worth a human's five seconds rather than silence.
 *
 * Deliberately NOT a citation parser: it does not try to resolve a file or a symbol, only
 * to flag "unexplained digit run near a citation-shaped fingerprint" so a coverage gap
 * shows up as a discrepancy instead of a smaller number nobody notices.
 */
const CANDIDATE_WINDOW = 15;
const CANDIDATE_KEYWORD_RE = /\.(?:ts|prisma)\b|\bschema\b|\bline\b/i;
function findUnrecognizedCandidates(masked) {
  const found = [];
  const digitRunRe = /\d{2,}/g;
  let m;
  while ((m = digitRunRe.exec(masked)) !== null) {
    // A bare backtick nearby is NOT enough on its own — a migration filename
    // (`20260915120000_seed_job_categories`) or an event key is backtick-wrapped and
    // digit-heavy without being remotely citation-shaped, and tripped this net on
    // every real run before the keyword requirement was added. A real citation always
    // sits next to one of these words or extensions; requiring one is what keeps the
    // net from being switched off after its first false alarm.
    const winStart = Math.max(0, m.index - CANDIDATE_WINDOW);
    const winEnd = Math.min(masked.length, m.index + m[0].length + CANDIDATE_WINDOW);
    const window = masked.slice(winStart, winEnd);
    if (CANDIDATE_KEYWORD_RE.test(window)) {
      found.push({ index: m.index, digits: m[0], context: window.trim() });
    }
  }
  return found;
}

function parseLineSpec(spec) {
  // "7" | "53-145" | "6,9,12" | "217-231"
  const points = [];
  let isRangeOrMulti = false;
  for (const part of spec.split(',')) {
    if (part.includes('-')) {
      isRangeOrMulti = true;
      const [a, b] = part.split('-').map((n) => Number.parseInt(n, 10));
      points.push(a, b);
    } else {
      points.push(Number.parseInt(part, 10));
    }
  }
  if (spec.includes(',')) isRangeOrMulti = true;
  return { points, isRangeOrMulti, max: Math.max(...points) };
}

const DECL_RE_TEMPLATE = (symbol) =>
  new RegExp(`(?:export\\s+(?:const|enum|type|interface)\\s+|(?:^|[^\\w])(?:model|enum)\\s+)${symbol}\\b`);

function resolveFile(index, kind, file) {
  if (kind === 'schema') return { status: 'ok', path: SCHEMA_PATH };
  const matches = index.get(file);
  if (!matches || matches.length === 0) return { status: 'not-found' };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches.map(rel) };
  return { status: 'ok', path: matches[0] };
}

function checkCitation(citation, index, fileCache) {
  const resolved = resolveFile(index, citation.kind, citation.file);
  const base = { file: citation.file, lineSpec: citation.lineSpec, symbol: citation.symbol };

  if (resolved.status === 'not-found') return { ...base, verdict: 'FILE-NOT-FOUND' };
  if (resolved.status === 'ambiguous') return { ...base, verdict: 'AMBIGUOUS-FILE', candidates: resolved.candidates };

  const rp = resolved.path;
  if (!fileCache.has(rp)) {
    fileCache.set(rp, readFileSync(rp, 'utf8').split(/\r?\n/));
  }
  const src = fileCache.get(rp);
  const { points, isRangeOrMulti, max } = parseLineSpec(citation.lineSpec);

  if (max > src.length) {
    return { ...base, verdict: 'PAST-EOF', fileLength: src.length, citedMax: max, resolvedPath: rel(rp) };
  }

  if (isRangeOrMulti || !citation.symbol) {
    return { ...base, verdict: 'NO-SYMBOL-TO-CHECK', resolvedPath: rel(rp) };
  }

  const lineNum = points[0];
  const atLine = src[lineNum - 1] ?? '';
  const wordBoundary = new RegExp(`\\b${citation.symbol}\\b`);
  if (wordBoundary.test(atLine)) {
    return { ...base, verdict: 'OK', resolvedPath: rel(rp) };
  }

  const declRe = DECL_RE_TEMPLATE(citation.symbol);
  const realIdx = src.findIndex((l) => declRe.test(l));
  return {
    ...base,
    verdict: 'DRIFTED',
    resolvedPath: rel(rp),
    citedLine: lineNum,
    actualLine: realIdx >= 0 ? realIdx + 1 : null,
    citedLineText: atLine.trim().slice(0, 80),
  };
}

function main() {
  const docSrc = readFileSync(DOC_PATH, 'utf8');
  const index = buildFileIndex(SEARCH_ROOTS);
  const fileCache = new Map();

  const results = [];
  const candidates = [];
  docSrc.split(/\r?\n/).forEach((line, i) => {
    const { citations, masked } = extractCitations(line);
    for (const c of citations) {
      results.push({ docLine: i + 1, ...checkCitation(c, index, fileCache) });
    }
    for (const cand of findUnrecognizedCandidates(masked)) {
      candidates.push({ docLine: i + 1, ...cand });
    }
  });

  const by = {};
  for (const r of results) by[r.verdict] = (by[r.verdict] ?? 0) + 1;

  const drifted = results.filter((r) => r.verdict === 'DRIFTED' || r.verdict === 'PAST-EOF');
  const unknown = results.filter((r) => r.verdict === 'FILE-NOT-FOUND' || r.verdict === 'AMBIGUOUS-FILE');

  // An unrecognised candidate is not a confirmed defect (DRIFTED) — it is exactly the same
  // epistemic status as UNKNOWN: "cannot vouch for this", never folded into a clean pass.
  const exitCode = drifted.length > 0 ? 2 : unknown.length > 0 || candidates.length > 0 ? 1 : 0;
  const status = exitCode === 2 ? 'DRIFTED' : exitCode === 1 ? 'UNKNOWN' : 'OK';

  const scope = `checks ONLY ${rel(DOC_PATH)} — an exit-0 here says nothing about citations in any other document`;

  if (asJson) {
    console.log(
      JSON.stringify(
        { docPath: rel(DOC_PATH), scope, total: results.length, byVerdict: by, unrecognizedCandidates: candidates, status, exitCode, results },
        null,
        2,
      ),
    );
  } else {
    console.log(`detect-lookup-inventory-citation-drift — ${rel(DOC_PATH)}`);
    console.log(scope + '\n');
    console.log(`total citations found: ${results.length}`);
    console.log(by);
    console.log('');
    for (const r of results.filter((x) => x.verdict === 'DRIFTED')) {
      console.log(
        `DRIFTED   doc:${r.docLine}  ${r.symbol}@${r.resolvedPath}:${r.citedLine} — cited line is "${r.citedLineText}"; ` +
          `actually at ${r.actualLine ?? 'not found anywhere in file'}`,
      );
    }
    for (const r of results.filter((x) => x.verdict === 'PAST-EOF')) {
      console.log(`PAST-EOF  doc:${r.docLine}  ${r.file}:${r.lineSpec} — file is only ${r.fileLength} lines`);
    }
    for (const r of results.filter((x) => x.verdict === 'FILE-NOT-FOUND')) {
      console.log(`NOT-FOUND doc:${r.docLine}  ${r.file}:${r.lineSpec} (symbol=${r.symbol ?? '(none)'}) — not under packages/shared/src, packages/database/prisma or apps/api/src`);
    }
    for (const r of results.filter((x) => x.verdict === 'AMBIGUOUS-FILE')) {
      console.log(`AMBIGUOUS doc:${r.docLine}  ${r.file}:${r.lineSpec} — matches ${r.candidates.join(', ')}`);
    }
    for (const c of candidates) {
      console.log(`UNRECOGNISED-CANDIDATE doc:${c.docLine}  "${c.digits}" in: ${c.context}`);
    }
    console.log(
      `\n${status}: ${drifted.length} confirmed drift/out-of-bounds, ${unknown.length} unresolvable, ${candidates.length} unrecognised candidates (coverage gap, not a confirmed drift), ` +
        `${by['NO-SYMBOL-TO-CHECK'] ?? 0} checked structurally only (no symbol), ${by['OK'] ?? 0} fully verified`,
    );
    console.log(`\nexit ${exitCode} (0 OK, 1 UNKNOWN or unrecognised candidate, 2 DRIFTED)`);
  }

  process.exit(exitCode);
}

main();
