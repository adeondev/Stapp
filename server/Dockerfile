# =======================================================================
# Stage 1: Build Web Frontend (Vite + React + TypeScript)
# =======================================================================
FROM node:22-alpine AS web-builder
WORKDIR /build/web

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY web/ ./
RUN pnpm build

# =======================================================================
# Stage 2: Build Rust Backend (axum + tokio + rusqlite bundled)
# =======================================================================
FROM rust:1.85-slim-bookworm AS server-builder
WORKDIR /build/server

# Install build dependencies for C-bundled rusqlite
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Cache dependency compilation
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src tests && \
    echo 'pub fn dummy() {}' > src/lib.rs && \
    echo 'fn main() {}' > src/main.rs && \
    echo 'fn main() {}' > tests/fluxo_completo.rs && \
    cargo build --release && \
    rm -rf src tests

COPY server/src ./src
COPY server/tests ./tests
RUN touch src/main.rs src/lib.rs && cargo build --release --bin stapp-server

# =======================================================================
# Stage 3: Minimal Runtime Image
# ======================================================================
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged system user
RUN groupadd -g 10001 stapp && \
    useradd -u 10001 -g stapp -d /app -s /usr/sbin/nologin stapp

WORKDIR /app

# Create application and storage directories
RUN mkdir -p /app/data/attachments /app/web/dist && \
   chown -R stapp:stapp /app

# Copy artifacts from builder stages
COPY --from=server-builder --chown=stapp:stapp /build/server/target/release/stapp-server /usr/local/bin/stapp-server
COPY --from=web-builder --chown=stapp:stapp /build/web/dist /app/web/dist
COPY --chown=stapp:stapp server/stapp.toml /app/stapp.toml

USER stapp

ENV STAPP_SERVER_BIND=0.0.0.0 \
    STAPP_SERVER_PORT=8787 \
    STAPP_SERVER_STATIC_DIR=/app/web/dist \
    STAPP_STORAGE_DATABASE=/app/data/stapp.db \
    STAPP_STORAGE_ATTACHMENTS_DIR=/app/data/attachments

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8787/health || exit 1

VOLUME ["/app/data"]

ENTRYPOINT ["/usr/local/bin/stapp-server", "--config", "/app/stapp.toml"]
