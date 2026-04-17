# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:20-bookworm-slim
ARG APT_FORCE_IPV4_CONFIG_PATH=/etc/apt/apt.conf.d/99force-ipv4

FROM ${NODE_IMAGE} AS build

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    PUPPETEER_SKIP_DOWNLOAD=true \
    npm_config_update_notifier=false

RUN printf 'Acquire::ForceIPv4 "true";\n' > "${APT_FORCE_IPV4_CONFIG_PATH}" \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

RUN npm --prefix client ci \
  && npm --prefix server ci

COPY . .

RUN npm --prefix client run build \
  && mkdir -p /app/.cache/puppeteer

FROM ${NODE_IMAGE} AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true

RUN printf 'Acquire::ForceIPv4 "true";\n' > "${APT_FORCE_IPV4_CONFIG_PATH}" \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    ffmpeg \
    fonts-liberation \
    python3 \
    yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/client/public ./client/public

RUN mkdir -p /app/data /app/.cache/puppeteer

EXPOSE 3000

CMD ["sh", "-lc", "cd /app/server && npm start"]
