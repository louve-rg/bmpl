# syntax=docker/dockerfile:1
# Multi-stage production image for @bmpl/api. Build context = repo ROOT.
#   docker build -f apps/api/Dockerfile -t bmpl-api .

# ---- Base: toolchain shared by build + runtime -----------------------------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# openssl: required by Prisma. python3/make/g++: for the argon2 native build.
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Build: install all deps, generate Prisma client, build packages + api --
FROM base AS build
# Root workspace config first (kept as its own layer).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc turbo.json tsconfig.base.json tsconfig.lib.json ./
# Workspace sources (package manifests + code).
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bmpl/database generate \
 && pnpm -r --filter "./packages/*" build \
 && pnpm --filter @bmpl/api build
# NOTE: dev deps are intentionally retained so the SAME image can run the
# release migration command (`prisma migrate deploy`) and the one-off cloud
# bootstrap (`tsx prisma/bootstrap.ts`). Slimming via `turbo prune` + a prod-only
# runtime is documented as a follow-up in docs/DEPLOYMENT.md.

# ---- Runtime: non-root -----------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
RUN useradd --create-home --uid 10001 bmpl
COPY --from=build --chown=bmpl:bmpl /app /app
USER bmpl
# Railway injects PORT; the app binds 0.0.0.0:$PORT (fallback 4000).
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node handles SIGTERM; Nest enableShutdownHooks() closes Prisma/Redis cleanly.
CMD ["node", "apps/api/dist/main.js"]
