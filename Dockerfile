# ── Builder ───────────────────────────────────────────────────────────────
# Debian-based (not Alpine): better-sqlite3's prebuilt binaries target glibc,
# and Alpine's musl libc would force a from-source compile that needs extra care.
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Fallback toolchain in case no prebuilt better-sqlite3 binary matches this
# platform/Node version and it has to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runner ────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3000

RUN groupadd -r nodejs && useradd -r -g nodejs martpos \
  && mkdir -p /app/data && chown -R martpos:nodejs /app/data

# Next.js "standalone" output already contains a pruned node_modules + server.js.
# public/ and .next/static are not included by standalone and must be copied in.
COPY --from=builder --chown=martpos:nodejs /app/.next/standalone ./
COPY --from=builder --chown=martpos:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=martpos:nodejs /app/public ./public

USER martpos
EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server.js"]
