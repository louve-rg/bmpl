# Changed-File Report — Phase 1

Brand-new repository: **all 167 files are additions.** Grouped by area below.
(`node_modules`, `.next`, `dist`, and Prisma-generated client are git-ignored and
not listed.)

## Root / tooling (12)
`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
`tsconfig.lib.json`, `.npmrc`, `.gitignore`, `.prettierrc.json`,
`.env.example`, `docker-compose.yml`, `README.md`, plus docs below.

## Docs (5)
`README.md`, `SECURITY.md`, `REMAINING_WORK.md`, `CHANGED_FILES.md`,
`docs/ARCHITECTURE.md`.

## packages/shared (9)
`src/{roles,districts,permissions,audit,notifications,wallet,user,index}.ts`,
`package.json`, `tsconfig.json` — enums, role catalog, districts, brand tokens.

## packages/validation (8)
`src/{common,auth,profile,roles,admin,index}.ts`, `package.json`, `tsconfig.json`
— Zod schemas + inferred types.

## packages/database (5)
`prisma/schema.prisma` (full data model), `prisma/seed.ts` (idempotent seed),
`src/index.ts` (Prisma singleton), `package.json`, `tsconfig.json`.

## packages/authentication (6)
`src/{password,tokens,jwt,index}.ts`, `package.json`, `tsconfig.json`
— argon2id, hashed/rotating tokens, JWT.

## packages/authorization (4)
`src/index.ts` + `src/index.test.ts`, `package.json`, `tsconfig.json`
— pure role/permission logic + unit tests.

## packages/wallet (4)
`src/index.ts` + `src/index.test.ts`, `package.json`, `tsconfig.json`
— double-entry ledger primitives + invariant tests.

## packages/notifications (3) & packages/ui (4)
notifications: `src/index.ts`, `package.json`, `tsconfig.json`.
ui: `src/{index,tokens}.ts`, `package.json`, `tsconfig.json`.

## apps/api — NestJS backend (34)
- Bootstrap/config: `src/main.ts`, `src/app.module.ts`, `src/config/{env,config.module}.ts`, `nest-cli.json`, `tsconfig.json`, `package.json`
- Common: `src/common/{auth-context,decorators,zod-validation.pipe}.ts` + pipe spec
- Prisma: `src/prisma/{prisma.service,prisma.module}.ts`
- Auth: `src/auth/{auth.controller,auth.service,session.service,auth-context.service,guards,cookies,auth.module}.ts`
- Users: `src/users/{users.controller,users.service,users.module}.ts`
- Roles: `src/roles/{roles.controller,roles.service,roles.module}.ts`
- Admin: `src/admin/{admin.controller,admin.service,admin.module}.ts`
- Audit: `src/audit/{audit.service,audit.module}.ts`
- Notifications: `src/notifications/{notifications.controller,notifications.service,notifications.module}.ts`
- Storage: `src/storage/{storage.service,storage.module}.ts`
- Tests: `vitest.config.ts`, `vitest.e2e.config.ts`, `test/role-workflow.e2e-spec.ts`

## apps/web — public site + customer dashboard (37)
- Config: `package.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `tailwind.config.ts`, `middleware.ts`
- App: `app/{layout,page,globals.css}`, auth pages `app/{login,register,forgot-password,reset-password,verify-email}/page.tsx`, dashboard `app/dashboard/{layout,page,roles/page,profile/page}.tsx`
- Components: `components/Logo.tsx`, `components/ui.tsx`, `components/auth/AuthShell.tsx`, `components/dashboard/{Sidebar,RoleSwitcher,LogoutButton}.tsx`, `components/landing/{Header,Hero,Services,WhyChooseUs,Wallet,Providers,MobilePromo,FinalCTA,Footer,data}.{tsx,ts}`
- Lib: `lib/{api,server-api,types}.ts`

## apps/admin — secured console (23)
- Config: `package.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `tailwind.config.ts`, `middleware.ts`
- App: `app/{layout,page,globals.css}`, `app/login/page.tsx`, `app/dashboard/{layout,page}.tsx`, applications `app/dashboard/applications/{page,[id]/page,[id]/ReviewActions,[id]/DocumentLink}.tsx`, users `app/dashboard/users/{page,[id]/page,[id]/RoleActions}.tsx`, `app/dashboard/audit/page.tsx`
- Components/lib: `components/{AdminShell,StatusBadge}.tsx`, `lib/{api,server-api}.ts`

## apps/mobile — Expo foundation (9)
`package.json`, `app.json`, `tsconfig.json`, `app/{_layout,index,login,home}.tsx`,
`lib/{api,auth-context}.tsx`.
