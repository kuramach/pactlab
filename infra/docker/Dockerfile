# Pactlab images for deployed environments (ADR 0019). Three targets from one build:
#   server — api and worker: production dependencies of those two apps only (small, so tasks start fast)
#   tools  — the whole workspace, for the one-off migrate and seed tasks (Prisma CLI, seed data)
#   web    — the Next.js app as a standalone server
# Build from the repository root:  docker build -f infra/docker/Dockerfile --target server .
# Deploys build both images in parallel with `docker buildx bake -f infra/docker/docker-bake.hcl`.
# Never bake secrets or .env files into an image: configuration arrives as task environment and secrets.

ARG NODE_IMAGE=node:22.19.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# pnpm from npm, pinned to the repo's packageManager: corepack cannot run pnpm 12's package layout.
RUN npm install --global --no-audit --no-fund pnpm@12.8.1 && pnpm --version
WORKDIR /repo

# Dependencies first, from the lockfile alone: this layer is reused (from the build cache) until
# pnpm-lock.yaml or pnpm-workspace.yaml changes, so a code-only change downloads nothing.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline \
 && pnpm --filter @pactlab/db exec prisma generate

FROM build AS web-build
# Public settings are compiled into the browser bundle, so they are build arguments per environment.
ARG NEXT_PUBLIC_APP_ENV
ARG NEXT_PUBLIC_API_ORIGIN
# Pages pre-rendered at build time read the server config too; the app is served from the same origin.
# (The task sets APP_BASE_URL again at run time.)
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN} APP_BASE_URL=${NEXT_PUBLIC_API_ORIGIN} NEXT_STANDALONE=1
RUN test -n "$NEXT_PUBLIC_APP_ENV" && test -n "$NEXT_PUBLIC_API_ORIGIN" \
 && pnpm --filter @pactlab/web build

# Amazon's published certificate bundle, for TLS to RDS. Readable by the non-root user the tasks run as
# (ADD's own --chmod is not applied by every builder), and checked.
FROM base AS rds-ca
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/pactlab/rds-ca-bundle.pem
RUN chmod 755 /etc/pactlab && chmod 644 /etc/pactlab/rds-ca-bundle.pem \
 && grep -q "BEGIN CERTIFICATE" /etc/pactlab/rds-ca-bundle.pem

# --- server: api / worker --------------------------------------------------
# Production dependencies of the api and worker and the workspace packages they use, from the fetched store.
FROM deps AS server-deps
COPY . .
# `pnpm fetch` also fills node_modules/.pnpm with every package; start empty so only these are linked.
RUN rm -rf node_modules \
 && pnpm install --frozen-lockfile --offline --prod --filter "@pactlab/api..." --filter "@pactlab/worker..."

# A fresh stage (without pnpm), so the package store and other apps' sources stay out of the image.
FROM ${NODE_IMAGE} AS server
WORKDIR /repo
COPY --from=rds-ca /etc/pactlab /etc/pactlab
COPY --from=server-deps /repo/package.json /repo/tsconfig.base.json ./
COPY --from=server-deps /repo/node_modules ./node_modules
COPY --from=server-deps /repo/packages ./packages
COPY --from=build /repo/packages/db/src/generated ./packages/db/src/generated
COPY --from=server-deps --chown=node:node /repo/apps/api ./apps/api
COPY --from=server-deps --chown=node:node /repo/apps/worker ./apps/worker
# Synthetic fixtures only (the fixture adapters read them).
COPY fixtures ./fixtures
COPY demo-data ./demo-data
USER node
ENV NODE_ENV=production
EXPOSE 4000
# The task definition picks the program (api by default, or worker), run with its package's own tsx.
WORKDIR /repo/apps/api
CMD ["./node_modules/.bin/tsx", "src/main.ts"]

# --- tools: migrate / seed -------------------------------------------------
FROM build AS tools
COPY --from=rds-ca /etc/pactlab /etc/pactlab
RUN chown -R node:node /repo/apps/api /repo/apps/worker
USER node
ENV NODE_ENV=production
WORKDIR /repo/apps/api
CMD ["./node_modules/.bin/tsx", "src/ops/migrate.ts"]

# --- web -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
