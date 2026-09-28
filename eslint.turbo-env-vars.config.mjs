// Narrow, standalone ESLint config — BMPL-325.
//
// This is deliberately NOT part of the root eslint.config.mjs (which is
// itself deliberately inert — see its own header comment — with no package
// wired to `pnpm lint` yet). Folding this in there would make a CI-enforced
// check ride along with an effort that explicitly promises nothing runs yet.
// This file has exactly one job: catch a `process.env.X` read in apps/admin
// or apps/web that `turbo.json` does not declare — the BMPL-224/BMPL-323
// shape, where a variable is genuinely configured on Vercel but invisible to
// the build because turbo's own strict env mode filters out anything
// undeclared. Run via `pnpm lint:turbo-env-vars`.
//
// Scope is the Next.js build surface only — app/components/lib/middleware/
// next.config.mjs — not test or e2e-support files, which run under a
// different turbo task (or no task at all: turbo.json has no `e2e`/`test:e2e`
// task) and are never bundled into the deployed app.
import tsParser from '@typescript-eslint/parser';
import turbo from 'eslint-plugin-turbo';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.test.mjs',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.spec.mjs',
      'apps/web/e2e/**',
    ],
  },
  {
    files: ['apps/admin/**/*.ts', 'apps/admin/**/*.tsx', 'apps/admin/**/*.mjs', 'apps/web/**/*.ts', 'apps/web/**/*.tsx', 'apps/web/**/*.mjs'],
    languageOptions: { parser: tsParser },
    plugins: { turbo },
    rules: {
      'turbo/no-undeclared-env-vars': [
        'error',
        {
          // Two exceptions, each is a real thing, not a guess:
          //
          // VERCEL_GIT_COMMIT_SHA — a genuine Vercel system variable. Never
          // configured in the project's dashboard, always present on Vercel,
          // absent locally/in CI (falls back to '' — see next.config.mjs).
          // Turbo's own strict env mode auto-allows Vercel system vars and
          // NEXT_PUBLIC_/EXPO_PUBLIC_ framework prefixes at build time; this
          // ESLint rule auto-allows the framework prefixes but not Vercel's
          // own system vars, so it needs telling once, here.
          //
          // BMPL_BUILD_COMMIT — not read from the real environment at all.
          // next.config.mjs's own `env` block synthesizes it from
          // VERCEL_GIT_COMMIT_SHA/NEXT_PUBLIC_COMMIT_SHA (both already
          // exempt) and Next.js re-exposes it via `process.env` purely as an
          // implementation detail of that feature. Declaring it in
          // turbo.json would claim something reads it from the real
          // environment, which nothing does.
          allowList: ['^VERCEL_GIT_COMMIT_SHA$', '^BMPL_BUILD_COMMIT$'],
        },
      ],
    },
  },
];
