# ── Stage 1: Install deps ──
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install

# ── Stage 2a: Prisma generate (separate layer for cache reuse) ──
# Generate the Prisma client whenever prisma/schema.prisma changes.
# A dedicated layer means schema edits don't force a full bun install
# rebuild — only the prisma generate step + downstream COPYs.
FROM deps AS prisma
WORKDIR /app
COPY prisma ./prisma
RUN bunx prisma generate

# ── Stage 2b: Build Next.js (memory capped) ──
FROM prisma AS build
WORKDIR /app
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=384
RUN bun run build

# ── Stage 3: App Runtime Container (no postgres, separate container) ──
FROM oven/bun:1-alpine
LABEL description="golradar — web app + nesine relay"

ENV NODE_ENV=production
ENV PORT=3000

# nodejs for prisma CLI; python3 + build tooling for Scrapling (curl_cffi
# compiles a C extension at install time). libstdc++ is needed for the
# prebuilt wheels too. Keep the package set minimal.
RUN apk add --no-cache \
      nodejs \
      python3 \
      py3-pip \
      gcc \
      musl-dev \
      libstdc++ \
      openssl-dev \
      cargo

# Pre-install Scrapling at image-build time. Use core package only
# (no [all] — that pulls in Playwright which requires glibc, not available
# on Alpine). The app only needs curl_cffi-based fetching.
RUN pip3 install --no-cache-dir --break-system-packages \
      'urllib3>=2,<3' \
      'certifi>=2024' \
      'idna>=3.6' \
      'requests>=2.31' \
      'charset-normalizer>=3' \
      && pip3 install --no-cache-dir --break-system-packages \
      'scrapling>=0.4' \
      'curl_cffi>=0.7' \
      'orjson>=3.10' \
      'lxml>=5' \
      'w3lib>=2' \
      'tld>=0.13' \
      'tldextract>=5'

# Next.js standalone
COPY --from=build /app/.next/standalone /app/web
COPY --from=build /app/.next/static /app/web/.next/static
COPY --from=build /app/public /app/web/public
COPY --from=build /app/prisma /app/web/prisma

# Prisma CLI + client (the entrypoint runs `prisma db push` from these)
COPY --from=build /app/node_modules/.prisma /app/web/node_modules/.prisma
COPY --from=build /app/node_modules/prisma /app/web/node_modules/prisma
COPY --from=build /app/node_modules/@prisma /app/web/node_modules/@prisma
COPY --from=build /app/node_modules/.bin /app/web/node_modules/.bin

# Sanity: ensure the Prisma CLI is actually executable. If the build
# context stripped the shebang or chmod bit, fall back to a known-good
# node entry.
RUN ls -la /app/web/node_modules/prisma/build/index.js && \
    chmod +x /app/web/node_modules/prisma/build/index.js

# Scrapling fetch scripts — copied into the runtime so the bridge + netscores
# paths resolve. Without these, resolvePython() in netscores.ts finds a
# runtime but execFile fails on a missing script.
COPY --from=build /app/scripts /app/web/scripts

# Nesine-live relay
WORKDIR /app/nesine
COPY --from=build /app/mini-services/nesine-live/package.json ./
COPY --from=build /app/mini-services/nesine-live/bun.lock ./
RUN bun install
COPY --from=build /app/mini-services/nesine-live/index.ts ./
COPY --from=build /app/mini-services/shared /app/shared

WORKDIR /app/web
EXPOSE 3000 3003

# Graceful start — wait for postgres, push schema, then start both
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
CMD ["/docker-entrypoint.sh"]
