#!/usr/bin/env node
/**
 * detect-notification-category-count-drift — does a hand-typed enum count
 * still match the enum? (BMPL-211)
 *
 * docs/quality/LOOKUP-DATA-INVENTORY.md states the NotificationCategory
 * enum's size as a literal number in prose: "Always (15 values)". That
 * number was WRONG for 55 days (the enum had 14 values when the line was
 * written, on 2026-08-02) and only became correct by accident on
 * 2026-09-26, when BMPL-168 added a 15th value (PASSENGER) for an unrelated
 * reason. Nothing caught the original error, because a hand-written count
 * has no way to signal that it has gone stale — it reads exactly the same
 * whether it is right or wrong. This is the thing that reads both sides and
 * says so.
 *
 *   node scripts/detect-notification-category-count-drift.mjs
 *   node scripts/detect-notification-category-count-drift.mjs --json
 *
 * Read-only, same boundary as scripts/detect-tracked-deletions.mjs and for
 * the same reason: it never edits the schema or the document, never rewrites
 * the stated count, and never runs git. A script that "fixes" the count for
 * you is how a wrong rule quietly turns a true document into a false one
 * without anyone reviewing the change. It reports; a human edits.
 *
 * WHAT THIS CHECKS:
 *   - Parses `enum NotificationCategory { ... }` out of
 *     packages/database/prisma/schema.prisma and counts the value lines
 *     (Prisma doc comments — /// — are skipped; they annotate one value,
 *     they are not one).
 *   - Parses the literal "(N value(s))" out of the "Notification categories"
 *     row of docs/quality/LOOKUP-DATA-INVENTORY.md.
 *   - Fails if the two numbers disagree, or if either side cannot be found
 *     at all (a missing enum or a reworded row is reported as UNKNOWN, never
 *     silently treated as a pass — "cannot verify" and "agrees" are
 *     different answers and this script never blurs them).
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - Any other enum, in any other document. This solves BMPL-211 for the
 *     one count it was filed about. Whether that generalises to a framework
 *     for every hand-written enumeration count in every doc is a separate,
 *     open question — see the PR/branch notes, not this script.
 *   - Whether the enum's VALUES (not just their count) match anything
 *     written elsewhere — two different sets of 15 values would still pass.
 *   - The TypeScript-side label maps (NOTIFICATION_CATEGORY_LABELS etc.) or
 *     any other consumer of the enum.
 *   - The "(schema:109)" line-number citation in the same table row, which
 *     is now ALSO stale (the enum starts at line 118, not 109) — a real,
 *     separate drift this script does not claim to catch, because a line
 *     number is not a count.
 *
 * Exit codes:
 *   0  MATCH    the document's stated count equals the schema's real count
 *   1  MISMATCH the two numbers disagree — the document needs a human edit
 *   2  UNKNOWN  the enum or the documented count could not be located/parsed
 *               at all — never reported as a pass
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'packages/database/prisma/schema.prisma');
const DOC_PATH = path.join(REPO_ROOT, 'docs/quality/LOOKUP-DATA-INVENTORY.md');
const ENUM_NAME = 'NotificationCategory';
const DOC_ROW_LABEL = 'Notification categories';

function readOrNull(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Counts real value lines inside `enum <name> { ... }`; skips blank lines and /// doc comments. */
function countEnumValues(schemaSrc, enumName) {
  const re = new RegExp(`enum\\s+${enumName}\\s*\\{([^}]*)\\}`, 's');
  const match = schemaSrc.match(re);
  if (!match) return null;
  const body = match[1];
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('///') && !l.startsWith('//'));
  return lines.length;
}

/** Extracts the "(N value[s])" integer from the doc's row for this lookup, wherever it sits in the row. */
function extractDocumentedCount(docSrc, rowLabel) {
  const lines = docSrc.split('\n');
  const row = lines.find((l) => l.includes(rowLabel));
  if (!row) return null;
  const m = row.match(/\((\d+)\s+values?\)/i);
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}

function main() {
  const schemaSrc = readOrNull(SCHEMA_PATH);
  const docSrc = readOrNull(DOC_PATH);

  const result = {
    schemaPath: path.relative(REPO_ROOT, SCHEMA_PATH).replace(/\\/g, '/'),
    docPath: path.relative(REPO_ROOT, DOC_PATH).replace(/\\/g, '/'),
    enumName: ENUM_NAME,
    actualCount: schemaSrc ? countEnumValues(schemaSrc, ENUM_NAME) : null,
    documentedCount: docSrc ? extractDocumentedCount(docSrc, DOC_ROW_LABEL) : null,
  };

  let status;
  let note;
  if (result.actualCount == null || result.documentedCount == null) {
    status = 'UNKNOWN';
    const missing = [];
    if (!schemaSrc) missing.push(`could not read ${result.schemaPath}`);
    else if (result.actualCount == null) missing.push(`enum ${ENUM_NAME} not found in ${result.schemaPath}`);
    if (!docSrc) missing.push(`could not read ${result.docPath}`);
    else if (result.documentedCount == null) missing.push(`no "(N value(s))" found on the "${DOC_ROW_LABEL}" row in ${result.docPath}`);
    note = missing.join('; ');
  } else if (result.actualCount === result.documentedCount) {
    status = 'MATCH';
    note = `${ENUM_NAME} has ${result.actualCount} values, matching the document's stated count`;
  } else {
    status = 'MISMATCH';
    note = `${ENUM_NAME} has ${result.actualCount} values but ${result.docPath} states ${result.documentedCount} — the document needs a human edit`;
  }

  const exitCode = status === 'MATCH' ? 0 : status === 'MISMATCH' ? 1 : 2;

  if (asJson) {
    console.log(JSON.stringify({ ...result, status, note, exitCode }, null, 2));
  } else {
    console.log(`detect-notification-category-count-drift — ${ENUM_NAME}\n`);
    console.log(`  schema actual count:     ${result.actualCount ?? '(not found)'}`);
    console.log(`  document stated count:   ${result.documentedCount ?? '(not found)'}`);
    console.log(`\n${status}: ${note}`);
    console.log(`\nexit ${exitCode} (0 MATCH, 1 MISMATCH, 2 UNKNOWN)`);
  }

  process.exit(exitCode);
}

main();
