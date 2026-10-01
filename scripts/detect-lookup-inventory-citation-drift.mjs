#!/usr/bin/env node
/**
 * detect-lookup-inventory-citation-drift — do these docs' file:line citations
 * still point at what they claim? (BMPL-211 follow-up; widened to three
 * documents by BMPL-384)
 *
 * Originally one document: docs/quality/LOOKUP-DATA-INVENTORY.md cites a
 * source line for almost every row — `jobs.ts:7`, `(schema:2372)`,
 * `schema.prisma:922`, `roles.ts:53-145`. One of those citations was checked
 * here already (BMPL-211: the enum-count row) and turned out wrong for 55
 * days. Before sweeping the rest, a throwaway script checked all of them by
 * hand and found the OTHER citations currently accurate — so this is not
 * "line numbers rot", it's "that one row was never revisited". This script
 * is the permanent version of that throwaway check.
 *
 * BMPL-383 found the same shape of defect in docs/EDWARD-REQUIREMENTS.md by
 * hand (three schema.prisma line citations drifted when the schema grew
 * after their own anchor commit) and BMPL-384 asked the obvious follow-up:
 * this script already enforces the exact right invariant, just scoped to
 * one document that didn't happen to be the one that drifted. Widening
 * DOC_PATHS to include EDWARD-REQUIREMENTS.md and OWNER-RULINGS.md is the
 * same check looking at more input, not a new check — see BMPL-381/382/383
 * for why a *prose* checker for those two documents was explicitly refused
 * (a script cannot decide whether a sentence is true); a file:line citation
 * is a different, mechanisable claim, which is exactly this script's domain
 * already.
 *
 *   node scripts/detect-lookup-inventory-citation-drift.mjs
 *   node scripts/detect-lookup-inventory-citation-drift.mjs --json
 *
 * Read-only, same boundary as detect-tracked-deletions.mjs and
 * detect-notification-category-count-drift.mjs: it never edits any document
 * or source file, and never runs git. It reports; a human edits.
 *
 * WHY A SECOND SCRIPT RATHER THAN FOLDING INTO detect-notification-category-
 * count-drift.mjs: that one checks a single fact (does this count match that
 * enum). This one walks whole documents and produces a list of findings with
 * several distinct "cannot check" reasons. Different shapes of output,
 * different exit-code semantics (a scalar match/mismatch vs. an aggregate
 * over N citations) — forcing them into one script would make the simpler
 * one harder to read for no shared code worth the coupling. They share a
 * pattern (derive, don't transcribe), not an implementation.
 *
 * WHAT THIS CHECKS:
 *   Every citation of the shape:
 *     - `` `file.ts:N` `` or `` `file.ts:N-M` `` or `` `file.ts:N,M,K` ``
 *       (backtick-wrapped file + line spec, any file ending .ts or .prisma —
 *       the file portion may be a bare filename, as LOOKUP-DATA-INVENTORY.md
 *       always writes it, OR a full repo-relative path with slashes, as
 *       EDWARD-REQUIREMENTS.md sometimes writes it — BMPL-384 widened the
 *       recognizer for the second shape rather than relying on the
 *       coincidence that a schema.prisma citation also happens to be found
 *       by the next pattern below regardless of what prefix it's buried in)
 *     - `schema:N` or `schema.prisma:N` (bare, no backticks, or found as a
 *       trailing substring of a longer backtick-wrapped full path — always
 *       packages/database/prisma/schema.prisma)
 *     - `` `Symbol` (N) `` (backtick symbol immediately followed by a bare
 *       parenthetical integer with no unit word — also schema.prisma)
 *     - `(N-M)` (a bare parenthetical range with no preceding symbol — schema.prisma)
 *     - `` `:N` `` (BMPL-384: a bare backtick-wrapped colon+number with NO
 *       file portion at all — EDWARD-REQUIREMENTS.md uses this as shorthand
 *       for "same file as the citation just before it", e.g.
 *       "(`schema.prisma:4894`, `:4909`)". Inherits the file/kind of the
 *       NEAREST PRECEDING citation already found on the SAME LINE. A `:N`
 *       with no earlier citation on its line has nothing to inherit and is
 *       reported FILE-NOT-FOUND rather than silently skipped.)
 *   For each: resolves the target file — a bare filename is searched for
 *   (recursively) under packages/shared/src, packages/database/prisma and
 *   apps/api/src, the same three roots as before; a citation containing a
 *   `/` is instead resolved directly as a path relative to the repo root,
 *   since a full path names its own location and searching for it by
 *   basename would risk matching the wrong file of the same name — and when
 *   a single specific line (not a range/list) has a resolvable symbol
 *   immediately before it in the same table cell or parenthetical, checks
 *   that the symbol is actually declared there, or names where it actually
 *   is. A symbol may now contain a dot (BMPL-384: `SavedAddress.isDefault`,
 *   a Prisma model-and-field citation style EDWARD-REQUIREMENTS.md uses that
 *   LOOKUP-DATA-INVENTORY.md's always-bare symbols never needed) — checked
 *   as a literal substring at the cited line exactly like a plain symbol;
 *   see the next section for the one thing this does NOT extend to.
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
 *   - When a DOTTED symbol (`Model.field`) is confirmed NOT at its cited
 *     line, the fallback search for "where is it actually declared" only
 *     recognises `model X`/`enum X`/`export const X`-shaped declarations —
 *     it was written for LOOKUP-DATA-INVENTORY.md's always-bare symbols and
 *     does not know how to locate a FIELD inside a model block. A drifted
 *     dotted citation is still correctly reported DRIFTED; it just names
 *     `actualLine: null` ("not found anywhere by this fallback") instead of
 *     pointing at the real line, the same honest degradation a totally
 *     unknown symbol already got before this change.
 *   - A `` `:N` `` continuation citation spanning TWO lines (the preceding
 *     citation on a different line than the short one) — only same-line
 *     inheritance is recognised. One was never observed in either document;
 *     if it appears, it is invisible the same way an unrecognised format
 *     always was before this script learned it, and the coverage net below
 *     is the backstop for exactly that case.
 *   - Any document other than the three named in DOC_PATHS below. Whether
 *     this generalises further is a separate, unasked question.
 *   - Whether the CONTENT at a correctly-cited line is semantically right
 *     (e.g. whether `EmploymentType` still has the right VALUES, or whether
 *     a correctly-cited `Model.field` is still the RIGHT field for the claim
 *     next to it) — only whether the named thing still lives where the
 *     document says it does.
 *   - Whether a document's PROSE is true. BMPL-384 exists because a
 *     file:line citation is mechanically checkable; the sentence sitting
 *     next to it is not, and this script has no opinion on it — the same
 *     boundary BMPL-381's commit-anchor checker drew for commit hashes,
 *     applied here to line numbers instead.
 *
 * THE COVERAGE NET (added after the schema.prisma:N-outside-backticks format fooled this
 * script's own first version): the recognizers above can only report on a citation
 * they matched. One they never learned to recognise is invisible by construction — no
 * different, from inside the tool, than a line with no citation at all. After masking
 * every real match, a second pass scans what's LEFT for the same fingerprint every real
 * citation in these documents has (a digit run near a backtick/`.ts`/`.prisma`/the words
 * "schema" or "line") and reports anything it still finds as UNRECOGNISED-CANDIDATE — not
 * a confirmed drift, but never folded into a pass either. It does not parse or resolve
 * the candidate; it only refuses to stay silent about it. It cannot catch a citation with
 * no digit/keyword fingerprint at all (plain prose has nothing to grep for) — meaningfully
 * narrower than complete, which is the honest limit of any regex-based net. (BMPL-384 ran
 * the UN-widened version of this script against both new documents before changing
 * anything, specifically to see whether the net alone would have been enough: it was not
 * — masking a recognised `schema.prisma:4894` citation also erases the word "schema" from
 * the window the NEXT citation's `:4909` needed to trip the net, so two adjacent citations
 * of this shape can mask each other into invisibility. That is exactly why `` `:N` `` needed
 * its own recognizer rather than being left to the net.)
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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// BMPL-384: three documents, not one. Order is report order, not significance.
const DOC_PATHS = ['docs/quality/LOOKUP-DATA-INVENTORY.md', 'docs/EDWARD-REQUIREMENTS.md', 'docs/OWNER-RULINGS.md'].map((p) =>
  path.join(REPO_ROOT, p),
);
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

  // 1) `` `file.(ts|prisma):LINESPEC` `` — LINESPEC is digits, commas, dashes.
  // The file portion allows `/` (BMPL-384): EDWARD-REQUIREMENTS.md sometimes
  // writes the full repo-relative path (`packages/database/prisma/schema.prisma`)
  // rather than LOOKUP-DATA-INVENTORY.md's always-bare filename. `kind` is
  // decided by ENDS-WITH rather than exact-equals so both spellings of the
  // schema citation take the same path.
  {
    const re = /`([\w./-]+\.(?:ts|prisma)):([\d,-]+)`/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      citations.push({ index: m.index, file: m[1], lineSpec: m[2], kind: m[1].endsWith('schema.prisma') ? 'schema' : 'ts' });
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
  // 5) `` `:N` `` (BMPL-384) — a bare colon+number with NO file portion at all,
  // EDWARD-REQUIREMENTS.md's shorthand for "same file as the citation right
  // before this one", e.g. "(`schema.prisma:4894`, `:4909`)". Must run AFTER
  // patterns 1-4 so there is something earlier on the line to inherit from;
  // sorts what's been found so far by position and takes whichever citation's
  // index is the largest one still less than this match's own index. A `:N`
  // with nothing earlier on its line has no file to inherit and is reported
  // FILE-NOT-FOUND (below) rather than silently dropped — a continuation with
  // nothing to continue is exactly as wrong as a citation with no file at all.
  {
    const priorOnLine = [...citations].sort((a, b) => a.index - b.index);
    const re = /`:(\d+)`/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      const inherited = [...priorOnLine].reverse().find((c) => c.index < m.index);
      citations.push({
        index: m.index,
        file: inherited?.file ?? null,
        lineSpec: m[1],
        kind: inherited?.kind ?? 'unknown',
      });
      mask(m.index, m.index + m[0].length);
    }
  }

  // Nearest preceding backtick-wrapped identifier, per citation, from the ORIGINAL
  // (unmasked) line — but never crossing a `|` table-cell boundary. Without that limit, a
  // citation in one cell can wrongly inherit a symbol name from an EARLIER cell in the same
  // row (e.g. a Prisma model name from the "source" cell bleeding into an unrelated citation
  // in the "public API" cell three columns later) — found by inspection, not by assumption.
  // Allows one embedded dot (BMPL-384: `SavedAddress.isDefault`) for EDWARD-REQUIREMENTS.md's
  // Model.field citation style — LOOKUP-DATA-INVENTORY.md's own symbols never contain one, so
  // this only adds matches, it does not change which bare identifier wins for the old doc.
  const idRe = /`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)`/g;
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
  if (!file) return { status: 'not-found' }; // pattern 5's `:N` with nothing to inherit
  // BMPL-384: a citation containing `/` names its own location directly — resolved
  // relative to the repo root, never by basename, so it can never be confused with
  // an unrelated file that happens to share a name elsewhere in the tree.
  if (file.includes('/')) {
    const full = path.join(REPO_ROOT, file);
    return existsSync(full) ? { status: 'ok', path: full } : { status: 'not-found' };
  }
  const matches = index.get(file);
  if (!matches || matches.length === 0) return { status: 'not-found' };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches.map(rel) };
  return { status: 'ok', path: matches[0] };
}

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  // BMPL-384: a dotted symbol (`Model.field`) names a FIELD, and a Prisma field's own
  // line never repeats its model's name — only the bare `isDefault Boolean ...` text
  // lives there, never `SavedAddress.isDefault`. Checking the dotted string literally
  // would never match on a real schema and every such citation would misreport as
  // DRIFTED even when it is exactly right (caught by running this for real, not by
  // reasoning about it — see BMPL-384's own PR notes). So only the part AFTER the last
  // dot is checked against the cited line — the same check a bare symbol already gets.
  const checkedPart = citation.symbol.includes('.') ? citation.symbol.slice(citation.symbol.lastIndexOf('.') + 1) : citation.symbol;
  const wordBoundary = new RegExp(`\\b${escapeForRegex(checkedPart)}\\b`);
  if (wordBoundary.test(atLine)) {
    return { ...base, verdict: 'OK', resolvedPath: rel(rp) };
  }

  // A dotted symbol is a Model.field citation; DECL_RE_TEMPLATE only recognises
  // model/enum/export-const declarations, not a field inside one, so it cannot name
  // where a drifted Model.field citation actually lives — see the header's own note
  // on this. Skipping the fallback for a dotted symbol is honest (actualLine stays
  // null, "not found anywhere by this fallback") rather than running a search built
  // for a different symbol shape and reporting a wrong or coincidental line.
  const declRe = citation.symbol.includes('.') ? null : DECL_RE_TEMPLATE(citation.symbol);
  const realIdx = declRe ? src.findIndex((l) => declRe.test(l)) : -1;
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
  const index = buildFileIndex(SEARCH_ROOTS);
  const fileCache = new Map();

  const results = [];
  const candidates = [];
  for (const docPath of DOC_PATHS) {
    const docRel = rel(docPath);
    const docSrc = readFileSync(docPath, 'utf8');
    docSrc.split(/\r?\n/).forEach((line, i) => {
      const { citations, masked } = extractCitations(line);
      for (const c of citations) {
        results.push({ doc: docRel, docLine: i + 1, ...checkCitation(c, index, fileCache) });
      }
      for (const cand of findUnrecognizedCandidates(masked)) {
        candidates.push({ doc: docRel, docLine: i + 1, ...cand });
      }
    });
  }

  const by = {};
  for (const r of results) by[r.verdict] = (by[r.verdict] ?? 0) + 1;

  const drifted = results.filter((r) => r.verdict === 'DRIFTED' || r.verdict === 'PAST-EOF');
  const unknown = results.filter((r) => r.verdict === 'FILE-NOT-FOUND' || r.verdict === 'AMBIGUOUS-FILE');

  // An unrecognised candidate is not a confirmed defect (DRIFTED) — it is exactly the same
  // epistemic status as UNKNOWN: "cannot vouch for this", never folded into a clean pass.
  const exitCode = drifted.length > 0 ? 2 : unknown.length > 0 || candidates.length > 0 ? 1 : 0;
  const status = exitCode === 2 ? 'DRIFTED' : exitCode === 1 ? 'UNKNOWN' : 'OK';

  const docList = DOC_PATHS.map(rel).join(', ');
  const scope = `checks ONLY ${docList} — an exit-0 here says nothing about citations in any other document`;

  if (asJson) {
    console.log(
      JSON.stringify(
        { docPaths: DOC_PATHS.map(rel), scope, total: results.length, byVerdict: by, unrecognizedCandidates: candidates, status, exitCode, results },
        null,
        2,
      ),
    );
  } else {
    console.log(`detect-lookup-inventory-citation-drift — ${docList}`);
    console.log(scope + '\n');
    console.log(`total citations found: ${results.length}`);
    console.log(`by verdict: ${Object.entries(by).map(([verdict, count]) => `${verdict} ${count}`).join(', ')}`);
    console.log('');
    for (const r of results.filter((x) => x.verdict === 'DRIFTED')) {
      console.log(
        `DRIFTED   ${r.doc}:${r.docLine}  ${r.symbol}@${r.resolvedPath}:${r.citedLine} — cited line is "${r.citedLineText}"; ` +
          `actually at ${r.actualLine ?? 'not found anywhere in file'}`,
      );
    }
    for (const r of results.filter((x) => x.verdict === 'PAST-EOF')) {
      console.log(`PAST-EOF  ${r.doc}:${r.docLine}  ${r.file}:${r.lineSpec} — file is only ${r.fileLength} lines`);
    }
    for (const r of results.filter((x) => x.verdict === 'FILE-NOT-FOUND')) {
      console.log(`NOT-FOUND ${r.doc}:${r.docLine}  ${r.file ?? '(none — a `:N` with nothing to inherit from)'}:${r.lineSpec} (symbol=${r.symbol ?? '(none)'})`);
    }
    for (const r of results.filter((x) => x.verdict === 'AMBIGUOUS-FILE')) {
      console.log(`AMBIGUOUS ${r.doc}:${r.docLine}  ${r.file}:${r.lineSpec} — matches ${r.candidates.join(', ')}`);
    }
    for (const c of candidates) {
      console.log(`UNRECOGNISED-CANDIDATE ${c.doc}:${c.docLine}  "${c.digits}" in: ${c.context}`);
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
