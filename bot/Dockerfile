# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

# Runtime deps:
#  - curl            : streams internet-radio URLs into ffmpeg + downloads yt-dlp
#  - ca-certificates : TLS for HTTPS sources
#  - python3         : required by the yt-dlp zipapp
# ffmpeg comes from the ffmpeg-static npm package (no system ffmpeg needed).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production node modules first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Fetch the latest yt-dlp at build time (YouTube extraction breaks often, so a
# fresh binary per image build is desirable). Lives where the app expects it.
RUN mkdir -p bin \
    && curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp \
    && chmod +x bin/yt-dlp

# Application code (config.json is intentionally NOT copied — provide secrets
# via env vars, and mount a volume if you want /autojoin changes to persist).
COPY src ./src
COPY config.example.json ./

# Drop root. /data holds the writable, persisted config (volume mount point);
# creating it owned by `bot` lets a fresh named volume inherit that ownership.
RUN useradd -m -u 10001 bot \
    && mkdir -p /data \
    && chown -R bot:bot /app /data
USER bot
VOLUME ["/data"]

ENV NODE_ENV=production
# Persisted, writable config location (mount a volume here to keep /autojoin).
ENV CONFIG_PATH=/data/config.json

CMD ["node", "src/index.js"]
