#!/usr/bin/env node
/**
 * measure-openapi-route-drift-all-specs — generalizes
 * detect-terminal-openapi-route-drift.mjs's mechanism (route-decorator
 * parsing + spec-path diff) across ALL FIVE hand-maintained specs under
 * docs/openapi/ (driver.yaml, marketplace.yaml, passenger.yaml,
 * shipping.yaml, terminal.yaml), not just the terminal family.
 * (OPENAPI-DRIFT-MEASURE, follow-up to MDF-742/TERM-OPENAPI-GUARD.)
 *
 * THIS IS A MEASUREMENT TOOL, NOT A CI CHECK. It is deliberately NOT
 * wired into ci.yml. A generalized check that can fail on any of four
 * other specs at once would turn main red on every unrelated PR the
 * moment one of them drifts — the exact harm BMPL-235/BMPL-310/BMPL-312
 * already named, and the same reason MDF-742's terminal-scoped step was
 * held back until #708 merged. Run it by hand, read the numbers, decide
 * what (if anything) is urgent. Fixing any spec found stale here is
 * explicitly out of scope for this script and this card.
 *
 *   node scripts/measure-openapi-route-drift-all-specs.mjs
 *   node scripts/measure-openapi-route-drift-all-specs.mjs --json
 *
 * Read-only: it never edits a spec or a controller, and never runs git.
 *
 * HOW A REAL ROUTE IS ASSIGNED TO "ITS OWN" SPEC FILE:
 *   Not hardcoded. Each of the five spec files is read for its own real
 *   top-level path keys, and each path is reduced to a FAMILY KEY: the
 *   first path segment, EXCEPT when that segment is `admin` or `driver`
 *   (both shared across multiple specs — e.g. `/admin/terminal/...` vs
 *   `/admin/logistics/...` vs `/admin/passengers/...`, and
 *   `/driver/jobs/...` vs `/driver/shipping-jobs/...` vs bare
 *   `/driver/profile`), where the first TWO segments are used instead.
 *   Every spec's own family keys are unioned into one map of
 *   familyKey -> specFile; checked once at startup that no two spec
 *   files ever claim the same family key (if that ever stops being true,
 *   this script refuses rather than guessing which file wins — see
 *   checkNoFamilyCollision below).
 *
 *   Every real controller in apps/api/src (ALL of it this time — not
 *   filtered to one domain, the same tree-walk convention
 *   detect-terminal-openapi-route-drift.mjs already set) is reduced to
 *   the same family key. A route whose family key matches a spec file's
 *   claimed set is checked against that file's real path+method entries.
 *   A route whose family key matches NO spec file at all (an entire
 *   undocumented domain, e.g. `admin/drivers`, `auth`, `users`) is
 *   reported separately as NO-SPEC-FOR-FAMILY — a different, larger kind
 *   of gap than drift inside a spec that otherwise covers the family,
 *   and deliberately not folded into any one file's undocumented count.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK — same scope limits as the
 * terminal-only script: route PRESENCE only (method + path), never
 * parameters/bodies/responses; a stale spec entry (documented, no
 * matching real route) is counted and printed but is not what "drift"
 * means for this report's headline numbers.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEARCH_ROOT = path.join(REPO_ROOT, 'apps/api/src');
const SPEC_FILES = ['driver.yaml', 'marketplace.yaml', 'passenger.yaml', 'shipping.yaml', 'terminal.yaml'];
const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.git']);
const METHODS = ['Get', 'Post', 'Patch', 'Put', 'Delete'];
const SHARED_SEGMENTS = new Set(['admin', 'driver']);

function rel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

function familyKeyOf(openApiPath) {
  const segs = openApiPath.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segs.length === 0) return '';
  if (SHARED_SEGMENTS.has(segs[0]) && segs.length >= 2) return `${segs[0]}/${segs[1]}`;
  return segs[0];
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
      else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// Same bracket/quote/comment-aware scanner as detect-terminal-openapi-route-drift.mjs,
// unfiltered by prefix family this time.
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

function toOpenApiPath(prefix, subpath) {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const s = (subpath ?? '').replace(/^\/+|\/+$/g, '');
  const combined = [p, s].filter((x) => x.length > 0).join('/');
  return '/' + combined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

const STRING_ARG_RE = /^\s*(?:'([^']*)'|"([^"]*)")?\s*$/;

/** Every @Controller(...) class in the whole tree, no prefix filter. */
function findAllRoutes(files) {
  const controllerRe = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)\s*export\s+class\s+(\w+)/g;
  const methodRe = new RegExp(`@(${METHODS.join('|')})\\(([^)]*)\\)`, 'g');
  const routes = [];
  const unparseable = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const commentRanges = findCommentRanges(src);

    const controllerMatches = [];
    let cm;
    controllerRe.lastIndex = 0;
    while ((cm = controllerRe.exec(src)) !== null) {
      if (isInsideAny(commentRanges, cm.index)) continue;
      const prefix = cm[1] ?? cm[2] ?? '';
      controllerMatches.push({ prefix, className: cm[3], bodyStart: cm.index + cm[0].length });
    }
    if (controllerMatches.length === 0) continue;

    for (let ci = 0; ci < controllerMatches.length; ci++) {
      const { prefix, className, bodyStart } = controllerMatches[ci];
      const bodyEnd = ci + 1 < controllerMatches.length ? controllerMatches[ci + 1].bodyStart : src.length;
      const body = src.slice(bodyStart, bodyEnd);
      const bodyCommentRanges = findCommentRanges(body);

      let mm;
      methodRe.lastIndex = 0;
      while ((mm = methodRe.exec(body)) !== null) {
        if (isInsideAny(bodyCommentRanges, mm.index)) continue;
        const absoluteIndex = bodyStart + mm.index;
        const lineNum = src.slice(0, absoluteIndex).split('\n').length;
        const verb = mm[1];
        const argMatch = STRING_ARG_RE.exec(mm[2]);
        if (!argMatch) {
          unparseable.push({ file: rel(file), line: lineNum, raw: `@${verb}(${mm[2]})` });
          continue;
        }
        const subpath = argMatch[1] ?? argMatch[2] ?? '';
        const openApiPath = toOpenApiPath(prefix, subpath);
        routes.push({
          method: verb.toUpperCase(),
          path: openApiPath,
          family: familyKeyOf(openApiPath),
          file: rel(file),
          line: lineNum,
          className,
        });
      }
    }
  }
  return { routes, unparseable };
}

/** Same flat 2-space/4-space scan convention every checker in this
 * directory uses — not a full YAML parser. The method-key line is matched
 * WITHOUT an end-of-line anchor on purpose: terminal/driver/passenger/
 * shipping.yaml all write each operation as its own nested block
 * (`    get:` alone on the line, body indented further below), but
 * marketplace.yaml mixes that with a compact inline flow-mapping style
 * (`    get: { tags: [...], ... }`, the whole operation on one line) for
 * most of its entries — confirmed directly: an end-of-line-anchored
 * version of this regex found only 34 of marketplace.yaml's real 295
 * method entries, silently treating 261 already-documented routes as
 * undocumented. Matching only the 4-space method-key prefix, regardless of
 * what follows on the same line, is correct for both styles. */
function parseSpecPaths(yamlSrc) {
  const lines = yamlSrc.split('\n');
  const entries = [];
  let currentPath = null;
  const pathKeyRe = /^ {2}(\/\S*):\s*$/;
  const methodKeyRe = /^ {4}(get|post|put|patch|delete):/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pathMatch = pathKeyRe.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    if (currentPath) {
      const methodMatch = methodKeyRe.exec(line);
      if (methodMatch) {
        entries.push({ method: methodMatch[1].toUpperCase(), path: currentPath, line: i + 1, family: familyKeyOf(currentPath) });
      }
    }
  }
  return entries;
}

function routeKey(method, p) {
  return `${method} ${p}`;
}

function main() {
  const specsByFile = {};
  for (const name of SPEC_FILES) {
    const full = path.join(REPO_ROOT, 'docs/openapi', name);
    let src;
    try {
      src = readFileSync(full, 'utf8');
    } catch {
      console.error(`UNKNOWN: could not read ${rel(full)}`);
      process.exitCode = 2;
      return;
    }
    const entries = parseSpecPaths(src);
    if (entries.length === 0) {
      console.error(`UNKNOWN: found zero path+method entries under "paths:" in ${rel(full)} -- the parser or the file is almost certainly broken, not actually empty`);
      process.exitCode = 2;
      return;
    }
    specsByFile[name] = entries;
  }

  // Build familyKey -> specFile, refusing to guess on a collision.
  const familyOwner = new Map();
  const collisions = [];
  for (const name of SPEC_FILES) {
    const families = new Set(specsByFile[name].map((e) => e.family));
    for (const fam of families) {
      if (familyOwner.has(fam) && familyOwner.get(fam) !== name) {
        collisions.push({ family: fam, files: [familyOwner.get(fam), name] });
      } else {
        familyOwner.set(fam, name);
      }
    }
  }
  if (collisions.length > 0) {
    console.error('UNKNOWN: two spec files claim the same family key -- refusing to guess which owns it:');
    for (const c of collisions) console.error(`  ${c.family}: ${c.files.join(' vs ')}`);
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

  const { routes, unparseable } = findAllRoutes(files);
  if (routes.length === 0) {
    console.error(`UNKNOWN: found zero routes under ${rel(SEARCH_ROOT)} -- the parser is almost certainly broken, not actually empty`);
    process.exitCode = 2;
    return;
  }

  const perFile = {};
  for (const name of SPEC_FILES) {
    const specEntries = specsByFile[name];
    const specKeys = new Set(specEntries.map((e) => routeKey(e.method, e.path)));
    const ownedRoutes = routes.filter((r) => familyOwner.get(r.family) === name);
    const routeKeys = new Set(ownedRoutes.map((r) => routeKey(r.method, r.path)));
    const undocumented = ownedRoutes.filter((r) => !specKeys.has(routeKey(r.method, r.path)));
    const staleSpecEntries = specEntries.filter((e) => !routeKeys.has(routeKey(e.method, e.path)));
    perFile[name] = { specEntries: specEntries.length, realRoutes: ownedRoutes.length, undocumented, staleSpecEntries };
  }

  const noSpecRoutes = routes.filter((r) => !familyOwner.has(r.family));
  const noSpecFamilies = [...new Set(noSpecRoutes.map((r) => r.family))].sort();

  const summary = Object.fromEntries(
    SPEC_FILES.map((name) => [
      name,
      {
        specEntries: perFile[name].specEntries,
        realRoutes: perFile[name].realRoutes,
        undocumented: perFile[name].undocumented.length,
        staleSpecEntries: perFile[name].staleSpecEntries.length,
      },
    ]),
  );

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          perFile: Object.fromEntries(
            SPEC_FILES.map((name) => [
              name,
              {
                ...summary[name],
                undocumented: perFile[name].undocumented.map(({ method, path: p, file, line, className }) => ({ method, path: p, file, line, className })),
                staleSpecEntries: perFile[name].staleSpecEntries.map(({ method, path: p, line }) => ({ method, path: p, line })),
              },
            ]),
          ),
          noSpecForFamily: { families: noSpecFamilies, routeCount: noSpecRoutes.length },
          unparseable,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('measure-openapi-route-drift-all-specs (OPENAPI-DRIFT-MEASURE) -- read-only, NOT wired into CI\n');
    console.log('per-spec route presence, family-partitioned (see this script\'s own header for how a route is assigned to a spec):\n');
    for (const name of SPEC_FILES) {
      const s = summary[name];
      console.log(`  ${name.padEnd(16)} real=${s.realRoutes}  spec=${s.specEntries}  undocumented=${s.undocumented}  stale=${s.staleSpecEntries}`);
    }
    console.log('');
    for (const name of SPEC_FILES) {
      const u = perFile[name].undocumented;
      if (u.length > 0) {
        console.log(`UNDOCUMENTED in ${name} (${u.length}):`);
        for (const r of u) console.log(`  ${r.method} ${r.path}  (${r.file}:${r.line}, ${r.className})`);
        console.log('');
      }
    }
    for (const name of SPEC_FILES) {
      const st = perFile[name].staleSpecEntries;
      if (st.length > 0) {
        console.log(`STALE-SPEC-ENTRY in ${name} (${st.length}, reported only -- not the headline number):`);
        for (const e of st) console.log(`  ${e.method} ${e.path}  (docs/openapi/${name}:${e.line})`);
        console.log('');
      }
    }
    if (noSpecRoutes.length > 0) {
      console.log(`NO-SPEC-FOR-FAMILY -- real route families with NO matching spec file at all, a different gap than drift inside a covered spec (${noSpecRoutes.length} routes across ${noSpecFamilies.length} families):`);
      console.log(`  families: ${noSpecFamilies.join(', ')}`);
      console.log('');
    }
    if (unparseable.length > 0) {
      console.log(`UNPARSEABLE-ROUTE -- a route decorator argument that is not a plain string literal (${unparseable.length}):`);
      for (const u of unparseable) console.log(`  ${u.file}:${u.line}  ${u.raw}`);
      console.log('');
    }
  }
}

main();
