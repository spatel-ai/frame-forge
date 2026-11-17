FROM python:3.13-slim

# ffmpeg: the mock provider, banner joining and templates need it (D-019).
# curl: used only by the healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.24 /uv /uvx /bin/

ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 PYTHONUNBUFFERED=1 \
    AVATAR_DATA_DIR=/data UV_NO_CACHE=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev && chmod +x docker-entrypoint.sh

RUN useradd --system --uid 10001 --home-dir /app app \
    && mkdir /data && chown app:app /data
USER app
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
