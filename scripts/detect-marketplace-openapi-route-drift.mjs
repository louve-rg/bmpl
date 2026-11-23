#!/usr/bin/env node
/**
 * detect-marketplace-openapi-route-drift — does docs/openapi/marketplace.yaml's
 * path list agree with what apps/api/src actually serves under the
 * marketplace surface? (API-MARKETPLACE-OPENAPI-UNGATED / PR 2, sibling of
 * detect-shipping-openapi-route-drift.mjs / detect-account-openapi-route-drift.mjs
 * / detect-terminal-openapi-route-drift.mjs)
 *
 * docs/openapi/marketplace.yaml was the one OpenAPI doc in this repo with NO
 * drift check at all: #854 shipped a documented POST release-reservations
 * route with no requestBody and the wrong response codes, and nothing in CI
 * noticed, because nothing was looking. A route-presence sizing pass
 * (API-MARKETPLACE-OPENAPI-UNGATED) found marketplace.yaml missing 9 real
 * routes and documenting an `{action}` path-param template for 2 resources
 * where the controllers actually expose 4 literal verb routes each; both
 * were fixed in #863 before this check was adopted, SAME CONDITION every
 * detector in this family is adopted under — a check only ever enforces
 * what is already true on the day it is switched on, never debt it inherited.
 * Same shape as the five working examples already wired into CI's
 * `repo-drift-checks` job (detect-notification-event-catalog-drift.mjs,
 * detect-permission-catalog-drift.mjs,
 * detect-lookup-inventory-citation-drift.mjs,
 * detect-notification-category-count-drift.mjs,
 * detect-terminal-openapi-route-drift.mjs, detect-account-openapi-route-drift.mjs,
 * detect-shipping-openapi-route-drift.mjs): read both sides, reconcile,
 * never silently pass on an unparseable side.
 *
 *   node scripts/detect-marketplace-openapi-route-drift.mjs
 *   node scripts/detect-marketplace-openapi-route-drift.mjs --json
 *
 * Read-only: it never edits the spec or a controller, and never runs git.
 * It reports; a human adds the missing spec entry or the missing route.
 *
 * WHAT THIS CHECKS:
 *   Walks ALL of apps/api/src (not just one family's directory — a future
 *   split of a controller into a second file, or a new controller added
 *   elsewhere for one of the prefixes below, must not go unnoticed) for every
 *   `@Controller('<prefix>') export class <Name>` and, inside each such
 *   class body, every `@Get/@Post/@Patch/@Put/@Delete('<subpath>')` member —
 *   but only for a controller whose prefix is one of the EXACT strings
 *   marketplace.yaml's own header claims (see MARKETPLACE_PREFIXES below).
 *   Joins prefix + subpath into one route, converts NestJS's `:param`
 *   segments (in either the prefix or the subpath — some controllers here
 *   carry one in the prefix itself, e.g. `vendor/products/:productId/images`)
 *   to OpenAPI's `{param}` segments, and reconciles that full METHOD+path
 *   set against the top-level path keys and their nested `get:`/`post:`/etc.
 *   operation keys under `docs/openapi/marketplace.yaml`'s `paths:` section.
 *
 * WHY AN EXACT-STRING ALLOWLIST, NOT A PREFIX-FAMILY STARTSWITH LIKE THE
 * OTHER THREE DETECTORS USE:
 *   shipping/account/terminal each own one or a few prefix ROOTS that no
 *   other spec touches (`shipping`, `admin/logistics`, `driver/shipping-jobs`
 *   for shipping; similarly for the other two), so `prefix === root ||
 *   prefix.startsWith(root + '/')` safely sweeps in every present and future
 *   sub-route of that root. marketplace.yaml is not shaped that way: by its
 *   own header it bundles catalog/search, vendors, products, cart,
 *   checkout/orders, payments & wallet, dispatch & delivery, settlement,
 *   reviews, AND the jobs/job-seeker/employer vertical — a flat list of
 *   distinct features, not one tree — and several of ITS roots (`admin/`,
 *   `vendor/`, `driver/`) are ALSO used by OTHER specs for unrelated
 *   sub-trees that must stay invisible here: `admin/logistics` (shipping),
 *   `admin/passengers` (passenger), `admin/drivers` / `admin/terminal`
 *   (their own files), `driver/shipping-jobs` (shipping),
 *   `passenger/driver*` (passenger). `startsWith('admin/')` or
 *   `startsWith('vendor/')` would wrongly pull every one of those in. So
 *   this script enumerates the full, exact base prefix of every controller
 *   marketplace.yaml's own header and section list actually cover, confirmed
 *   by reading every `@Controller(...)` in apps/api/src at the time this was
 *   written (API-MARKETPLACE-OPENAPI-UNGATED sizing pass) — see
 *   MARKETPLACE_PREFIXES. The tradeoff this accepts, stated plainly: a brand
 *   new controller for a genuinely new marketplace feature under a prefix
 *   not yet in that list is invisible to this script until someone adds its
 *   prefix here, the same way a shipping controller under an unrelated new
 *   root name would be invisible to detect-shipping-openapi-route-drift.mjs.
 *   Two controllers (OrdersController, EngagementController) use a bare
 *   `@Controller()` with no prefix at all, contributing routes entirely from
 *   their own method-level literal paths (`orders`, `checkout`, `saved`,
 *   `recently-viewed`, ...) — confirmed, at the time this was written, to be
 *   the ONLY two bare `@Controller()` classes anywhere in apps/api/src, so
 *   allowing the empty string here cannot silently sweep in an unrelated
 *   domain's routes. If a third bare `@Controller()` is ever added elsewhere
 *   for a non-marketplace domain, this script would wrongly claim its
 *   routes too — rerun the same `grep -rn "@Controller()" apps/api/src`
 *   check this script's header relied on before trusting a red or green
 *   result if that assumption is ever in doubt.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - Parameters, request/response bodies, status codes, or any other
 *     content of a documented operation. A route that exists on both sides
 *     with a completely wrong schema is invisible to this script — this is
 *     exactly the #854 class (a documented route with no requestBody and the
 *     wrong response codes), and it is NOT what this check catches. Content
 *     accuracy is a separate, unstarted, unmeasured initiative — there is no
 *     mechanical way to diff a NestJS Zod/class-validator DTO against an
 *     inline OpenAPI schema the way route presence can be diffed, so closing
 *     that gap needs real schema-comparison logic, not a copy of this script.
 *   - Any controller whose prefix is not in MARKETPLACE_PREFIXES (see above).
 *   - Any route decorator argument that is not a plain string literal (a
 *     computed or templated path is flagged as UNPARSEABLE-ROUTE below,
 *     never silently skipped or guessed at).
 *   - Whether a documented operation's summary, tags or security scheme are
 *     correct — only whether the method+path pair exists at all.
 *   - Every other spec under docs/openapi/ (account, driver, passenger,
 *     shipping, terminal). Those are each other detectors' concern.
 *
 * ASYMMETRIC ON PURPOSE, same shape as the other three route-drift checks: a
 * real route missing from the spec (UNDOCUMENTED-ROUTE) is the drift this
 * card exists for and FAILS the build. A spec entry with no matching real
 * route (STALE-SPEC-ENTRY) is reported but does NOT fail.
 *
 * Exit codes:
 *   0  OK      every real marketplace route is documented; any stale spec
 *              entries are printed but do not fail (see ASYMMETRIC note)
 *   1  DRIFT   at least one real route has no matching spec entry
 *   2  UNKNOWN  the spec or the controller tree could not be read/parsed at
 *               all — never folded into a pass. A checker that passes when
 *               it fails to parse anything is worse than no checker, because
 *               it reports a green tick for a question it never asked.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = path.join(REPO_ROOT, 'docs/openapi/marketplace.yaml');
const SEARCH_ROOT = path.join(REPO_ROOT, 'apps/api/src');
const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.git']);
const METHODS = ['Get', 'Post', 'Patch', 'Put', 'Delete'];

/**
 * Every exact base prefix marketplace.yaml documents, confirmed against
 * every `@Controller(...)` in apps/api/src at the time this was written
 * (API-MARKETPLACE-OPENAPI-UNGATED sizing pass). '' is OrdersController and
 * EngagementController's bare `@Controller()` — see the header comment on
 * why that is safe to allow here specifically.
 */
const MARKETPLACE_PREFIXES = new Set([
  '',
  'addresses',
  'admin/analytics',
  'admin/categories',
  'admin/deliveries',
  'admin/jobs',
  'admin/ops',
  'admin/orders',
  'admin/payments',
  'admin/products',
  'admin/reviews',
  'admin/settlements',
  'admin/support',
  'admin/vendors',
  'admin/wallet',
  'back-in-stock',
  'cart',
  'checkout',
  'conversations',
  'deliveries',
  'driver/earnings',
  'driver/jobs',
  'employer',
  'job-seeker',
  'jobs',
  'marketplace',
  'marketplace/categories',
  'marketplace/products',
  'marketplace/reviews',
  'marketplace/vendors',
  'notifications',
  'orders',
  'payments',
  'recommendations',
  'reviews',
  'vendor',
  'vendor/analytics',
  'vendor/delivery',
  'vendor/deliveries',
  'vendor/orders',
  'vendor/products',
  'vendor/products/:productId',
  'vendor/products/:productId/images',
  'vendor/products/:productId/inventory',
  'vendor/reviews',
  'vendor/settlements',
  'wallet',
]);

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

function toOpenApiPath(prefix, subpath) {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const s = (subpath ?? '').replace(/^\/+|\/+$/g, '');
  const combined = [p, s].filter((x) => x.length > 0).join('/');
  return '/' + combined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

const STRING_ARG_RE = /^\s*(?:'([^']*)'|"([^"]*)")?\s*$/;

/**
 * Every `@Controller('<prefix>') export class <Name> { ... }` block whose
 * prefix is in MARKETPLACE_PREFIXES, and every route decorator inside it. A
 * controller class body is approximated as "from the end of this `export
 * class Name` match to the start of the NEXT top-level `@Controller(`
 * decorator, or EOF" — correct for this codebase's own convention of one
 * class per `@Controller`, never a nested one.
 */
function findMarketplaceRoutes(files) {
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
      if (!MARKETPLACE_PREFIXES.has(prefix)) continue;
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
 * text-scan convention every checker in this directory already uses rather
 * than a full YAML parser): a path key is `  /some/path:` (exactly 2-space
 * indent), and each operation under it is `    get:` / `post:` / etc.
 * (exactly 4-space indent, matched without an end-of-line anchor so both a
 * nested-block operation and marketplace.yaml's own inline flow-mapping
 * style, e.g. `get: { tags: [...], ... }`, are caught — marketplace.yaml
 * uses the flow-mapping style almost everywhere, which is exactly why this
 * regex has no `$` anchor, matching measure-openapi-route-drift-all-specs.mjs
 * and the other three detectors' own parseSpecPaths exactly).
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

  const { routes, unparseable } = findMarketplaceRoutes(files);
  if (routes.length === 0) {
    console.error(`UNKNOWN: found zero marketplace routes under ${rel(SEARCH_ROOT)} -- the parser or MARKETPLACE_PREFIXES is almost certainly broken, not actually empty`);
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
    `checks ONLY route PRESENCE (method + path) between every @Controller(...) decorator under ${rel(SEARCH_ROOT)} whose ` +
    `prefix is one of marketplace.yaml's own exact base prefixes (MARKETPLACE_PREFIXES in this script -- see its header for why ` +
    `this is an exact allowlist rather than a shipping/account/terminal-style prefix-family match) and the path keys under ` +
    `"paths:" in ${rel(SPEC_PATH)} -- no parameters, bodies, responses or other documented content, and no other spec. A ` +
    `documented-but-missing route (STALE-SPEC-ENTRY) is reported but does not fail this check; only a real, undocumented route ` +
    `does (see this script's own header for why that asymmetry is deliberate).`;

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
    console.log('detect-marketplace-openapi-route-drift');
    console.log(scope + '\n');
    console.log(`real marketplace routes: ${summary.realRoutes} | spec path+method entries: ${summary.specEntries}\n`);

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
