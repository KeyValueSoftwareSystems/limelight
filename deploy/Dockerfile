# ─── Single-image deployment for Limelight ───────────────────────────────────
# Runs Hub (8770) + Portal (8800) + Next.js UI (3000) behind Nginx (80).
# One URL serves everything: / → UI, /api/* + /audio/* + /covers/* → Portal.

# ── Stage 1: Build the Next.js frontend ──────────────────────────────────────
FROM node:20-slim AS ui-builder

WORKDIR /build
COPY limelight-ui/package.json limelight-ui/package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install

COPY limelight-ui/ ./

# API calls go to the same origin via Nginx reverse proxy — no separate URL.
ENV NEXT_PUBLIC_API_URL=""
RUN npm run build


# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      nginx \
      supervisor \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Copy the repo (hub, portal, protocol, readers needed at runtime) ────────
COPY hub/          hub/
COPY portal/       portal/
COPY protocol/     protocol/
COPY readers/      readers/
COPY serve.py      serve.py

# ── Copy the built Next.js standalone app ────────────────────────────────────
COPY --from=ui-builder /build/.next/standalone  limelight-ui/
COPY --from=ui-builder /build/.next/static      limelight-ui/.next/static
COPY --from=ui-builder /build/public            limelight-ui/public

# ── Nginx config ─────────────────────────────────────────────────────────────
COPY deploy/nginx.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# ── Supervisor config ────────────────────────────────────────────────────────
COPY deploy/supervisord.conf /etc/supervisor/conf.d/limelight.conf

# ── Ensure data directories exist ────────────────────────────────────────────
RUN mkdir -p hub/files portal/shows portal/work portal/market portal/showfiles portal/covers portal/logos

# ── Healthcheck ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -sf http://localhost/ || exit 1

EXPOSE 80

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/limelight.conf"]
