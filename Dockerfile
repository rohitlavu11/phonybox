# syntax=docker/dockerfile:1.7
#
# Phonybox: one image with the emulators, the control API and the web inspector.
#
#   docker build -t phonybox .
#   docker run --rm -p 4100-4102:4100-4102 phonybox
#
# Configure with PHONYBOX_* environment variables (see `phonybox --help`).

# ---------------------------------------------------------------- web app
# Static files only, so build them natively even when targeting another architecture.
FROM --platform=$BUILDPLATFORM node:25-alpine AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @phonybox/web...
COPY apps/web apps/web
RUN pnpm --filter @phonybox/web build

# ----------------------------------------------------------------- server
FROM python:3.13-slim AS server
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY apps/server/pyproject.toml apps/server/uv.lock apps/server/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --extra postgres --no-install-project
COPY apps/server/src src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --extra postgres --no-editable

# ---------------------------------------------------------------- runtime
FROM python:3.13-slim
LABEL org.opencontainers.image.title="Phonybox" \
      org.opencontainers.image.description="Local Mailgun and Telnyx emulators for testing apps and AI agents that send email, SMS and fax." \
      org.opencontainers.image.source="https://github.com/rohitlavu11/phonybox" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN useradd --create-home --uid 10001 phonybox && mkdir /data && chown phonybox /data
COPY --from=server /app/.venv /app/.venv
COPY --from=web /src/apps/web/dist /app/web

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PHONYBOX_HOST=0.0.0.0 \
    PHONYBOX_UI=/app/web \
    PHONYBOX_SEED=small \
    PHONYBOX_WEBHOOK_BASE=http://host.docker.internal:3000

USER phonybox
WORKDIR /data
# 4100: inspector UI + control API   4101: Mailgun   4102: Telnyx
EXPOSE 4100 4101 4102
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4100/api/health', timeout=2)"]
ENTRYPOINT ["phonybox"]
CMD ["serve"]
