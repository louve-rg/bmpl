#!/usr/bin/env node
// Reads the NDJSON files `apps/{web,admin}/e2e/support/contrast-sweep.ts`
// write before `assertRatchet` can throw (one line per PASS/FAIL/AMBIGUOUS
// reading, every field a SweepReading already carries -- ratio, required
// ratio, dominantShare, foreground, dominantBackground) and prints a
// Markdown summary to stdout, for the CI step to redirect into
// $GITHUB_STEP_SUMMARY. `if: always()`, pure read-and-print, no exit code
// other than 0 or "file genuinely missing" -- never a pass/fail verdict.
// That verdict stays exactly where it already lives: the enforce step's
// own `if` condition on `steps.contrast-{web,admin}.outcome`.
//
// Built because the enforce step's own `continue-on-error: true` means its
// conclusion is always 'success' regardless of outcome, and reconstructing
// the real failing/ambiguous counts required downloading job logs and
// hand-parsing them -- five bad merge verifications in one night (god,
// 2026-10-22, MDF-376). This prints the real numbers on every run, inline
// in the job summary, without touching that `if` condition or any
// `continue-on-error` anywhere.
//
// Usage: node scripts/summarize-contrast-ndjson.mjs <path> [<path> ...]
// Each path is optional -- a missing file (e.g. a job that failed before
// the contrast step ever ran) is reported as "not found", not an error.

import { readFileSync, existsSync } from 'node:fs';

function collapseByElement(records) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.route}|${r.elementKind}|${r.accessibleRole}|${r.accessibleName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        route: r.route,
        elementKind: r.elementKind,
        accessibleRole: r.accessibleRole,
        accessibleName: r.accessibleName,
        bucket: r.bucket,
        requiredRatio: r.requiredRatio,
        widths: new Set(),
        ratios: new Set(),
        shares: new Set(),
        foreground: r.foreground,
        dominantBackground: r.dominantBackground,
      });
    }
    const g = groups.get(key);
    g.widths.add(r.viewport);
    g.ratios.add(r.ratio);
    g.shares.add(r.dominantShare);
    // A reading can legitimately land in different buckets at different
    // widths (a responsive layout, or the instrument-instability pattern
    // flagged 2026-10-22) -- keep the most severe bucket seen so a FAIL at
    // even one width is never hidden behind a PASS at the others.
    const severity = { fail: 2, ambiguous: 1, pass: 0 };
    if (severity[r.bucket] > severity[g.bucket]) g.bucket = r.bucket;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    widths: [...g.widths].sort((a, b) => a - b),
    ratios: [...g.ratios].sort((a, b) => a - b),
    shares: [...g.shares].sort((a, b) => a - b),
  }));
}

function fmtRatioRange(ratios) {
  return ratios.length === 1 ? `${ratios[0]}` : `${ratios[0]}..${ratios[ratios.length - 1]}`;
}

function rgb(c) {
  return c ? `rgb(${c.r},${c.g},${c.b})` : '(none)';
}

function summarizeApp(app, path) {
  const lines = [];
  lines.push(`### Contrast sweep -- ${app}`);
  if (!existsSync(path)) {
    lines.push('', `**${path}** not found -- the contrast step did not run far enough to produce it (see the step's own outcome above).`, '');
    return lines.join('\n');
  }
  const raw = readFileSync(path, 'utf8').trim();
  if (raw === '') {
    lines.push('', `**${path}** is empty -- zero readings recorded.`, '');
    return lines.join('\n');
  }
  const records = raw.split('\n').map((l) => JSON.parse(l));
  const totalsByBucket = { pass: 0, fail: 0, ambiguous: 0 };
  for (const r of records) totalsByBucket[r.bucket]++;
  const elements = collapseByElement(records);
  const failElements = elements.filter((e) => e.bucket === 'fail');
  const ambiguousElements = elements.filter((e) => e.bucket === 'ambiguous');
  const passElements = elements.filter((e) => e.bucket === 'pass');

  lines.push(
    '',
    `${records.length} raw readings, ${elements.length} distinct elements -- pass=${passElements.length} fail=${failElements.length} ambiguous=${ambiguousElements.length} (raw reading counts: pass=${totalsByBucket.pass} fail=${totalsByBucket.fail} ambiguous=${totalsByBucket.ambiguous}).`,
    '',
  );

  if (failElements.length > 0) {
    lines.push('**FAIL** (confirmed, dominantShare >= 0.5 by construction -- the sweep itself routed these out of ambiguous):', '');
    lines.push('| route | kind | role | name | ratio | needs | share | fg | bg | widths |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const e of failElements.sort((a, b) => a.route.localeCompare(b.route))) {
      lines.push(
        `| ${e.route} | ${e.elementKind} | ${e.accessibleRole ?? '(none)'} | ${e.accessibleName ?? '(none)'} | ${fmtRatioRange(e.ratios)} | ${e.requiredRatio} | ${fmtRatioRange(e.shares)} | ${rgb(e.foreground)} | ${rgb(e.dominantBackground)} | ${e.widths.length}/9 [${e.widths.join(',')}] |`,
      );
    }
    lines.push('');
  } else {
    lines.push('**FAIL**: none.', '');
  }

  if (ambiguousElements.length > 0) {
    lines.push(`**AMBIGUOUS** (${ambiguousElements.length} distinct elements, low dominantShare -- not failures, the instrument declining to measure a composite/glass surface):`, '');
    lines.push('| route | kind | role | name | ratio range | share range | widths |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const e of ambiguousElements.sort((a, b) => a.route.localeCompare(b.route))) {
      lines.push(`| ${e.route} | ${e.elementKind} | ${e.accessibleRole ?? '(none)'} | ${e.accessibleName ?? '(none)'} | ${fmtRatioRange(e.ratios)} | ${fmtRatioRange(e.shares)} | ${e.widths.length}/9 |`);
    }
    lines.push('');
  } else {
    lines.push('**AMBIGUOUS**: none.', '');
  }

  return lines.join('\n');
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: node scripts/summarize-contrast-ndjson.mjs <path-to-ndjson> [<path> ...]');
  process.exit(1);
}
for (const p of paths) {
  const app = p.includes('/admin/') || p.includes('\\admin\\') ? 'admin' : p.includes('/web/') || p.includes('\\web\\') ? 'web' : p;
  console.log(summarizeApp(app, p));
}
