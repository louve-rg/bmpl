// Root ESLint flat config — the foundation, deliberately inert.
//
// No package declares a `lint` script against this yet; packages are onboarded
// one at a time so existing violations stay visible instead of becoming a wall
// of red. See docs/quality/ESLINT-BASELINE.md (added when the pilot lands).
//
// Rules are correctness-focused, not stylistic — Prettier owns formatting.
// The high-value pair for a NestJS/Prisma codebase is no-floating-promises and
// no-misused-promises: an unawaited Prisma call is a silently dropped write.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Build output, caches and generated code. The generated Prisma client
    // lives in node_modules (default `prisma-client-js` output), so it is
    // covered by the node_modules ignore.
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        // Type-aware linting: reuse each package's own tsconfig.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // Test files are excluded from the packages' tsconfigs (they never build),
    // so the project service cannot type them. Lint them without type
    // information rather than crashing on "file not found in project".
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
