#!/usr/bin/env node
/**
 * detect-shipping-openapi-route-drift — does docs/openapi/shipping.yaml's
 * path list agree with what apps/api/src actually serves under `shipping`,
 * `admin/logistics` and `driver/shipping-jobs`? (DOCS-SHIPPING-SPEC-24-UNDOCUMENTED,
 * sibling of detect-account-openapi-route-drift.mjs / CI-OPENAPI-DRIFT-MEASURE-AND-ADOPT)
 *
 * docs/openapi/shipping.yaml is hand-maintained with nothing generating it.
 * It was found missing 24 of its 113 real routes (21%, the worst gap in the
 * repo) by hand-running the all-specs measurement tool
 * (scripts/measure-openapi-route-drift-all-specs.mjs) and fixed across three
 * PRs (#830 admin carrier-lifecycle, #832 carrier self-service, #835 the
 * remaining five strays) — exactly the kind of drift that goes unnoticed
 * without a check that runs on every later PR. Adopted NOW, while
 * shipping.yaml measures at zero drift, specifically so this check can only
 * ever enforce what is already true and never has to special-case debt it
 * inherited — the same condition account.yaml's own check was adopted
 * under, and terminal.yaml's before that.
 * Same shape as the six working examples already wired into CI's
 * `repo-drift-checks` job (detect-notification-event-catalog-drift.mjs,
 * detect-permission-catalog-drift.mjs,
 * detect-lookup-inventory-citation-drift.mjs,
 * detect-notification-category-count-drift.mjs,
 * detect-terminal-openapi-route-drift.mjs,
 * detect-account-openapi-route-drift.mjs): read both sides, reconcile,
 * never silently pass on an unparseable side.
 *
 *   node scripts/detect-shipping-openapi-route-drift.mjs
 *   node scripts/detect-shipping-openapi-route-drift.mjs --json
 *
 * Read-only: it never edits the spec or a controller, and never runs git.
 * It reports; a human adds the missing spec entry or the missing route.
 *
 * WHAT THIS CHECKS:
 *   Walks ALL of apps/api/src (not just apps/api/src/shipping/ — a future
 *   split of a controller into a second file, or a new shipping-family
 *   controller added elsewhere, must not go unnoticed) for every
 *   `@Controller('<prefix>') export class <Name>` and, inside each such
 *   class body, every `@Get/@Post/@Patch/@Put/@Delete('<subpath>')` member
 *   — but only for a prefix that IS `shipping`, starts with `shipping/`, IS
 *   `admin/logistics`, starts with `admin/logistics/`, IS
 *   `driver/shipping-jobs`, or starts with `driver/shipping-jobs/`; a
 *   controller for an unrelated domain (including a different
 *   `admin/...` or `driver/...` family, e.g. `admin/drivers` or
 *   `driver/jobs`) is invisible to this script by design — the same
 *   two-segment carve-out `measure-openapi-route-drift-all-specs.mjs` uses
 *   for the `admin`/`driver` prefixes it shares across specs, confirmed by
 *   that script's own startup collision check to not overlap any other
 *   spec file's family keys. Joins prefix + subpath into one route,
 *   converts NestJS's `:param` segments to OpenAPI's `{param}` segments,
 *   and reconciles that full METHOD+path set against the top-level path
 *   keys and their nested `get:`/`post:`/etc. operation keys under
 *   `docs/openapi/shipping.yaml`'s `paths:` section.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - Parameters, request/response bodies, status codes, or any other
 *     content of a documented operation. A route that exists on both sides
 *     with a completely wrong schema is invisible to this script.
 *   - Any controller outside the shipping/admin-logistics/driver-shipping-jobs
 *     families above.
 *   - Any route decorator argument that is not a plain string literal (a
 *     computed or templated path is flagged as UNPARSEABLE-ROUTE below,
 *     never silently skipped or guessed at).
 *   - Whether a documented operation's summary, tags or security scheme
 *     are correct — only whether the method+path pair exists at all.
 *   - Every other spec under docs/openapi/ (account, driver, marketplace,
 *     passenger). Those are deliberately not this script's concern — a
 *     generalized check across all specs would fail on any of their
 *     existing drift immediately, which is exactly why
 *     measure-openapi-route-drift-all-specs.mjs stays hand-run and this one
 *     stays scoped to the one spec it is written for.
 *
 * ASYMMETRIC ON PURPOSE, same shape as detect-account-openapi-route-drift.mjs:
 * a real route missing from the spec (UNDOCUMENTED-ROUTE) is the drift this
 * card exists for and FAILS the build. A spec entry with no matching real
 * route (STALE-SPEC-ENTRY) is reported but does NOT fail.
 *
 * Exit codes:
 *   0  OK      every real shipping/admin-logistics/driver-shipping-jobs
 *              route is documented; any stale spec entries are printed but
 *              do not fail (see ASYMMETRIC note)
 *   1  DRIFT   at least one real route has no matching spec entry
 *   2  UNKNOWN  the spec or the controller tree could not be read/parsed
 *               at all — never folded into a pass. A checker that passes
 *               when it fails to parse anything is worse than no checker,
 *               because it reports a green tick for a question it never
 *               asked.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = path.join(REPO_ROOT, 'docs/openapi/shipping.yaml');
const SEARCH_ROOT = path.join(REPO_ROOT, 'apps/api/src');
const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.git']);
const METHODS = ['Get', 'Post', 'Patch', 'Put', 'Delete'];

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
      else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Finds every `//...` and block-comment range in `src` so a decorator-like
 * string that merely appears inside a doc comment is never mistaken for a
 * real call site (BMPL-304).
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

/** True for `shipping`, `shipping/provider`, `admin/logistics`,
 * `admin/logistics/legs`, `driver/shipping-jobs`, etc. False for an
 * unrelated domain's controller, including a different `admin/...` or
 * `driver/...` family (e.g. `admin/drivers`, `driver/jobs`) — those belong
 * to other specs or no spec at all, never to this one. */
function isShippingPrefix(prefix) {
  return (
    prefix === 'shipping' ||
    prefix.startsWith('shipping/') ||
    prefix === 'admin/logistics' ||
    prefix.startsWith('admin/logistics/') ||
    prefix === 'driver/shipping-jobs' ||
    prefix.startsWith('driver/shipping-jobs/')
  );
}

function toOpenApiPath(prefix, subpath) {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const s = (subpath ?? '').replace(/^\/+|\/+$/g, '');
  const combined = [p, s].filter((x) => x.length > 0).join('/');
  return '/' + combined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

const STRING_ARG_RE = /^\s*(?:'([^']*)'|"([^"]*)")?\s*$/;

/**
 * Every `@Controller('<prefix>') export class <Name> { ... }` block whose
 * prefix matches the shipping family, and every route decorator inside it.
 * A controller class body is approximated as "from the end of this
 * `export class Name` match to the start of the NEXT top-level
 * `@Controller(` decorator, or EOF" — correct for this codebase's own
 * convention of one class per `@Controller`, never a nested one.
 */
function findShippingRoutes(files) {
  const controllerRe = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)\s*export\s+class\s+(\w+)/g;
  const methodRe = new RegExp(`@(${METHODS.join('|')})\\(([^)]*)\\)`, 'g');
  const routes = []; // {method, path, file, line, className}
  const unparseable = []; // {file, line, raw}

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
      if (!isShippingPrefix(prefix)) continue;
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
        routes.push({
          method: verb.toUpperCase(),
          path: toOpenApiPath(prefix, subpath),
          file: rel(file),
          line: lineNum,
          className,
        });
      }
    }
  }
  return { routes, unparseable };
}

/**
 * The spec's `paths:` section is a flat, regex-friendly shape (same
 * text-scan convention every checker in this directory already uses
 * rather than a full YAML parser): a path key is `  /some/path:` (exactly
 * 2-space indent), and each operation under it is `    get:` / `post:` /
 * etc. (exactly 4-space indent, matched without an end-of-line anchor so a
 * nested-block operation and marketplace.yaml-style inline flow-mapping
 * would both be caught — shipping.yaml only uses the nested-block style
 * today, but this matches measure-openapi-route-drift-all-specs.mjs's own
 * regex exactly rather than a narrower one that happens to work now).
 */
function parseSpecPaths(yamlSrc) {
  const lines = yamlSrc.split('\n');
  const entries = []; // {method, path, line}
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
        entries.push({ method: methodMatch[1].toUpperCase(), path: currentPath, line: i + 1 });
      }
    }
  }
  return entries;
}

function routeKey(method, p) {
  return `${method} ${p}`;
}

function main() {
  let specSrc;
  try {
    specSrc = readFileSync(SPEC_PATH, 'utf8');
  } catch {
    console.error(`UNKNOWN: could not read ${rel(SPEC_PATH)}`);
    process.exitCode = 2;
    return;
  }
  const specEntries = parseSpecPaths(specSrc);
  if (specEntries.length === 0) {
    console.error(`UNKNOWN: found zero path+method entries under "paths:" in ${rel(SPEC_PATH)} -- the parser or the file is almost certainly broken, not actually empty`);
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

  const { routes, unparseable } = findShippingRoutes(files);
  if (routes.length === 0) {
    console.error(`UNKNOWN: found zero shipping/admin-logistics/driver-shipping-jobs routes under ${rel(SEARCH_ROOT)} -- the parser or the prefix match is almost certainly broken, not actually empty`);
    process.exitCode = 2;
    return;
  }

  const specKeys = new Set(specEntries.map((e) => routeKey(e.method, e.path)));
  const routeKeys = new Set(routes.map((r) => routeKey(r.method, r.path)));

  const undocumented = routes.filter((r) => !specKeys.has(routeKey(r.method, r.path)));
  const staleSpecEntries = specEntries.filter((e) => !routeKeys.has(routeKey(e.method, e.path)));

  const drift = undocumented.length > 0;
  const exitCode = drift ? 1 : 0;
  const status = drift ? 'DRIFT' : 'OK';

  const scope =
    `checks ONLY route PRESENCE (method + path) between every @Controller('shipping...'/'admin/logistics...'/'driver/shipping-jobs...') ` +
    `decorator under ${rel(SEARCH_ROOT)} and the path keys under "paths:" in ${rel(SPEC_PATH)} -- no parameters, bodies, responses or ` +
    `other documented content, and no other spec. A documented-but-missing route (STALE-SPEC-ENTRY) is reported but does not ` +
    `fail this check; only a real, undocumented route does (see this script's own header for why that asymmetry is deliberate).`;

  const summary = {
    realRoutes: routes.length,
    specEntries: specEntries.length,
    undocumented: undocumented.length,
    staleSpecEntries: staleSpecEntries.length,
    unparseableRouteArgs: unparseable.length,
  };

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          scope,
          summary,
          status,
          exitCode,
          undocumented: undocumented.map(({ method, path: p, file, line, className }) => ({ method, path: p, file, line, className })),
          staleSpecEntries: staleSpecEntries.map(({ method, path: p, line }) => ({ method, path: p, line })),
          unparseable,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('detect-shipping-openapi-route-drift');
    console.log(scope + '\n');
    console.log(`real shipping/admin-logistics/driver-shipping-jobs routes: ${summary.realRoutes} | spec path+method entries: ${summary.specEntries}\n`);

    if (undocumented.length > 0) {
      console.log(`UNDOCUMENTED-ROUTE — a real route with no matching spec entry, FAILS this check (${undocumented.length}):`);
      for (const r of undocumented) console.log(`  ${r.method} ${r.path}  (${r.file}:${r.line}, ${r.className})`);
      console.log('');
    }
    if (staleSpecEntries.length > 0) {
      console.log(`STALE-SPEC-ENTRY — documented but no matching real route, reported but does NOT fail this check (${staleSpecEntries.length}):`);
      for (const e of staleSpecEntries) console.log(`  ${e.method} ${e.path}  (${rel(SPEC_PATH)}:${e.line})`);
      console.log('');
    }
    if (unparseable.length > 0) {
      console.log(`UNPARSEABLE-ROUTE — a route decorator argument that is not a plain string literal, FLAGGED FOR MANUAL READ, never silently skipped (${unparseable.length}):`);
      for (const u of unparseable) console.log(`  ${u.file}:${u.line}  ${u.raw}`);
      console.log('');
    }

    console.log(`${status}: ${undocumented.length} undocumented route(s), ${staleSpecEntries.length} stale spec entr${staleSpecEntries.length === 1 ? 'y' : 'ies'}, ${unparseable.length} unparseable route arg(s)`);
    console.log(`\nexit ${exitCode} (0 OK, 1 DRIFT -- a real route missing from the spec; a stale spec entry or an unparseable arg alone does not raise this)`);
  }

  process.exitCode = exitCode;
}

main();
