# Pactlab images for deployed environments (ADR 0019). Two targets from one build:
#   server — api, worker, and the one-off migrate and seed tasks (different commands)
#   web    — the Next.js app as a standalone server
# Build from the repository root:  docker build -f infra/docker/Dockerfile --target server .
# Never bake secrets or .env files into an image: configuration arrives as task environment and secrets.

ARG NODE_IMAGE=node:22.19.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# pnpm from npm, pinned to the repo's packageManager: corepack cannot run pnpm 12's package layout.
RUN npm install --global --no-audit --no-fund pnpm@12.8.1 && pnpm --version
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
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

# --- server: api / worker / migrate / seed ---------------------------------
FROM build AS server
# TLS to RDS is verified against Amazon's published certificate bundle.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/pactlab/rds-ca-bundle.pem
RUN chown -R node:node /repo/apps/api /repo/apps/worker
USER node
ENV NODE_ENV=production
EXPOSE 4000
# The task definition picks the command: api (default), worker, migrate or seed.
CMD ["pnpm", "--filter", "@pactlab/api", "start"]

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
