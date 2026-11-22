#!/usr/bin/env node
/**
 * detect-account-openapi-route-drift — does docs/openapi/account.yaml's
 * path list agree with what apps/api/src actually serves under `me/*` and
 * `auth/*`? (CI-OPENAPI-DRIFT-MEASURE-AND-ADOPT, sibling of
 * detect-terminal-openapi-route-drift.mjs / MDF-741)
 *
 * docs/openapi/account.yaml is hand-maintained with nothing generating it.
 * It was written in #815 (MDF-952) missing all 10 of AuthController's
 * routes, found only by hand-running the all-specs measurement tool
 * (scripts/measure-openapi-route-drift-all-specs.mjs) and fixed in #822 —
 * exactly the kind of drift that goes unnoticed without a check that runs
 * on every later PR. Adopted NOW, while account.yaml measures at zero
 * drift, specifically so this check can only ever enforce what is already
 * true and never has to special-case debt it inherited — the same
 * condition terminal.yaml's check was held back for, until #708 landed.
 * Same shape as the five working examples already wired into CI's
 * `repo-drift-checks` job (detect-notification-event-catalog-drift.mjs,
 * detect-permission-catalog-drift.mjs,
 * detect-lookup-inventory-citation-drift.mjs,
 * detect-notification-category-count-drift.mjs,
 * detect-terminal-openapi-route-drift.mjs): read both sides, reconcile,
 * never silently pass on an unparseable side.
 *
 *   node scripts/detect-account-openapi-route-drift.mjs
 *   node scripts/detect-account-openapi-route-drift.mjs --json
 *
 * Read-only: it never edits the spec or a controller, and never runs git.
 * It reports; a human adds the missing spec entry or the missing route.
 *
 * WHAT THIS CHECKS:
 *   Walks ALL of apps/api/src (not just apps/api/src/auth/ or
 *   apps/api/src/users/ — a future split of either controller into a
 *   second file must not go unnoticed) for every
 *   `@Controller('<prefix>') export class <Name>` and, inside each such
 *   class body, every `@Get/@Post/@Patch/@Put/@Delete('<subpath>')` member
 *   — but only for a prefix that IS `me`, starts with `me/`, IS `auth`, or
 *   starts with `auth/`; a controller for an unrelated domain is invisible
 *   to this script by design. Joins prefix + subpath into one route,
 *   converts NestJS's `:param` segments to OpenAPI's `{param}` segments,
 *   and reconciles that full METHOD+path set against the top-level path
 *   keys and their nested `get:`/`post:`/etc. operation keys under
 *   `docs/openapi/account.yaml`'s `paths:` section.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - Parameters, request/response bodies, status codes, or any other
 *     content of a documented operation. A route that exists on both sides
 *     with a completely wrong schema is invisible to this script.
 *   - Any controller outside the me/auth prefix families above — in
 *     particular `GET /users/{id}/avatar` (the public, unauthenticated
 *     avatar redirect) is a `users` family route, deliberately OUT of
 *     account.yaml's own scope per that spec's header, and therefore out
 *     of this script's scope too. Pulling it in would make this check
 *     demand documentation for something already decided not to be
 *     documented here.
 *   - Any route decorator argument that is not a plain string literal (a
 *     computed or templated path is flagged as UNPARSEABLE-ROUTE below,
 *     never silently skipped or guessed at).
 *   - Whether a documented operation's summary, tags or security scheme
 *     are correct — only whether the method+path pair exists at all.
 *   - Every other spec under docs/openapi/ (driver, marketplace,
 *     passenger, shipping). Those have real, measured drift today
 *     (scripts/measure-openapi-route-drift-all-specs.mjs) and are
 *     deliberately not this script's concern — a generalized check across
 *     all specs would fail on that existing drift immediately, which is
 *     exactly why that tool stays hand-run and this one stays scoped to
 *     the one spec that is actually clean.
 *
 * ASYMMETRIC ON PURPOSE, same shape as detect-terminal-openapi-route-drift.mjs:
 * a real route missing from the spec (UNDOCUMENTED-ROUTE) is the drift
 * this card exists for and FAILS the build. A spec entry with no matching
 * real route (STALE-SPEC-ENTRY) is reported but does NOT fail.
 *
 * Exit codes:
 *   0  OK      every real me/auth route is documented; any stale spec
 *              entries are printed but do not fail (see ASYMMETRIC note)
 *   1  DRIFT   at least one real route has no matching spec entry
 *   2  UNKNOWN  the spec or the controller tree could not be read/parsed
 *               at all — never folded into a pass
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = path.join(REPO_ROOT, 'docs/openapi/account.yaml');
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

/** True for `me`, `me/profile`, `auth`, `auth/change-password`, etc.
 * False for an unrelated domain's controller, including `users` (the
 * public avatar redirect lives there and is deliberately out of scope —
 * see this script's header). */
function isAccountPrefix(prefix) {
  return prefix === 'me' || prefix.startsWith('me/') || prefix === 'auth' || prefix.startsWith('auth/');
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
 * prefix matches the me/auth family, and every route decorator inside it.
 * A controller class body is approximated as "from the end of this
 * `export class Name` match to the start of the NEXT top-level
 * `@Controller(` decorator, or EOF" — correct for this codebase's own
 * convention of one class per `@Controller`, never a nested one.
 */
function findAccountRoutes(files) {
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
      if (!isAccountPrefix(prefix)) continue;
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
 * etc. (exactly 4-space indent) until the next 2-space path key.
 */
function parseSpecPaths(yamlSrc) {
  const lines = yamlSrc.split('\n');
  const entries = []; // {method, path, line}
  let currentPath = null;
  const pathKeyRe = /^ {2}(\/\S*):\s*$/;
  const methodKeyRe = /^ {4}(get|post|put|patch|delete):\s*$/;
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

  const { routes, unparseable } = findAccountRoutes(files);
  if (routes.length === 0) {
    console.error(`UNKNOWN: found zero me/auth routes under ${rel(SEARCH_ROOT)} -- the parser or the prefix match is almost certainly broken, not actually empty`);
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
    `checks ONLY route PRESENCE (method + path) between every @Controller('me...'/'auth...') decorator ` +
    `under ${rel(SEARCH_ROOT)} and the path keys under "paths:" in ${rel(SPEC_PATH)} -- no parameters, bodies, responses or ` +
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
    console.log('detect-account-openapi-route-drift');
    console.log(scope + '\n');
    console.log(`real me/auth routes: ${summary.realRoutes} | spec path+method entries: ${summary.specEntries}\n`);

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
