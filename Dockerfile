# Dokploy single-container build: FastAPI API on localhost:8000 + Next.js web on :3000
FROM node:24-bookworm-slim AS web-deps
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci

FROM node:24-bookworm-slim AS web-build
WORKDIR /app/web
COPY --from=web-deps /app/web/node_modules ./node_modules
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm prune --omit=dev

FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    PORT=3000 \
    API_PORT=8000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data/storage \
    DATABASE_URL=sqlite:////data/spotifrei.db \
    COOKIE_SECURE=true \
    COOKIE_SAMESITE=lax

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

COPY api/ /app/api/
COPY --from=web-build /app/web /app/web
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh && mkdir -p /data/storage

EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]
