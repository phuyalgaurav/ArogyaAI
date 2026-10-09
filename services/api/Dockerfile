FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --no-dev
RUN mkdir /data && chown 65532:65532 /data
ENV AROGYA_DATABASE_PATH=/data/arogya.sqlite3
USER 65532:65532
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "arogya_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
