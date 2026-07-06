# ── Stage 1: Install deps ──
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install

# ── Stage 2a: Prisma generate (separate layer for cache reuse) ──
FROM deps AS prisma
WORKDIR /app
COPY prisma ./prisma
RUN bunx prisma generate

# ── Stage 2b: Build Next.js + Python deps ──
FROM prisma AS build
WORKDIR /app
COPY . .

# Build tools for Python C extensions (Scrapling/curl_cffi compile at install time)
RUN apk add --no-cache \
      python3 \
      py3-pip \
      gcc \
      musl-dev \
      libstdc++ \
      openssl-dev \
      cargo

ENV NODE_OPTIONS=--max-old-space-size=384
RUN bun run build

# Install Python packages to known path (no version guessing)
RUN pip3 install --no-cache-dir --break-system-packages --target /python-packages \
      'urllib3>=2,<3' \
      'certifi>=2024' \
      'idna>=3.6' \
      'requests>=2.31' \
      'charset-normalizer>=3' \
      && pip3 install --no-cache-dir --break-system-packages --target /python-packages \
      'scrapling>=0.4' \
      'curl_cffi>=0.7' \
      'orjson>=3.10' \
      'lxml>=5' \
      'w3lib>=2' \
      'tld>=0.13' \
      'tldextract>=5' \
      'datafc>=2.7,<3' \
      'httpx>=0.27'

# ── Stage 3: Runtime ──
FROM oven/bun:1-alpine
LABEL description="golradar — web app + nesine relay"

ENV NODE_ENV=production
ENV PORT=3012
ENV HOSTNAME=0.0.0.0

# Minimal runtime deps — NO build tools (no gcc, cargo, musl-dev, py3-pip)
RUN apk add --no-cache \
      python3 \
      libstdc++ \
      nodejs

# Copy pre-built Python packages (compiled .so files, no runtime compilation needed)
COPY --from=build /python-packages /python-packages
ENV PYTHONPATH=/python-packages

# Next.js standalone
COPY --from=build /app/.next/standalone /app/web
COPY --from=build /app/.next/static /app/web/.next/static
COPY --from=build /app/public /app/web/public
COPY --from=build /app/prisma /app/web/prisma

# Prisma CLI + client
COPY --from=build /app/node_modules/.prisma /app/web/node_modules/.prisma
COPY --from=build /app/node_modules/prisma /app/web/node_modules/prisma
COPY --from=build /app/node_modules/@prisma /app/web/node_modules/@prisma
COPY --from=build /app/node_modules/.bin /app/web/node_modules/.bin

# Ensure Prisma CLI executable
RUN ls -la /app/web/node_modules/prisma/build/index.js && \
    chmod +x /app/web/node_modules/prisma/build/index.js

# Scrapling fetch scripts
COPY --from=build /app/scripts /app/web/scripts

# FotMob teams CSV
COPY --from=build /app/docs/fotmob_teams.csv /app/web/docs/fotmob_teams.csv

# Nesine-live relay
WORKDIR /app/nesine
COPY --from=build /app/mini-services/nesine-live/package.json ./
COPY --from=build /app/mini-services/nesine-live/bun.lock ./
RUN bun install
COPY --from=build /app/mini-services/nesine-live/index.ts ./
COPY --from=build /app/mini-services/shared /app/shared

WORKDIR /app/web

# Create non-root user
RUN addgroup -S golradar -g 1001 && \
    adduser -S golradar -u 1001 -G golradar && \
    chown -R golradar:golradar /app

EXPOSE 3012 3003

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:3012/api', timeout=5)" || exit 1

# Drop root — run as non-root user
USER golradar

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
CMD ["/docker-entrypoint.sh"]
