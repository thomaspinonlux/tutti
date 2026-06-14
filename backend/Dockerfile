# syntax=docker/dockerfile:1.7
# Tutti backend — image Docker pour Railway.
# Multi-stage : build avec pnpm + tsc, runtime minimal Node 22 alpine.

FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace manifests (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY shared/package.json shared/

# Install all deps including dev (TS compiler needed)
RUN pnpm install --frozen-lockfile

# Copy sources
COPY shared/ shared/
COPY backend/ backend/

# Build @tutti/shared → shared/dist. Consommé au RUNTIME via exports
# "node": "./dist/index.js". PAS de `|| true` : si shared ne compile pas on
# veut casser le build ici, pas produire une image qui crash-loop au boot.
RUN pnpm --filter @tutti/shared run build

# Generate Prisma client + compile TypeScript
WORKDIR /app/backend
RUN pnpm exec prisma generate
RUN pnpm exec tsc

# ────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY shared/package.json shared/

# Install only production deps
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output + Prisma artifacts.
# shared/DIST (pas src) : le runtime résout @tutti/shared via exports
# "node":"./dist/index.js". Sans dist dans l'image, Node retombait sur le .ts
# source (shared/src/index.ts → import './types/index.js' absent) = crash-loop.
COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/prisma backend/prisma
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/node_modules/.pnpm/@prisma+client* node_modules/.pnpm/

# Re-generate Prisma client at runtime stage to ensure native binaries match
WORKDIR /app/backend
RUN pnpm exec prisma generate

ENV NODE_ENV=production
EXPOSE 3001

# Apply migrations on boot then start server
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/server.js"]
