FROM python:3.12-slim-bookworm
ARG APP_COMMIT
LABEL org.opencontainers.image.source="https://github.com/domyshev/health" \
      org.opencontainers.image.revision="$APP_COMMIT"
RUN groupadd --gid 10002 importer && useradd --uid 10002 --gid 10002 --no-create-home importer
WORKDIR /app
COPY importer/pyproject.toml importer/README.md /app/importer/
COPY importer/src/ /app/importer/src/
COPY migrations/ /app/migrations/
RUN pip install --no-cache-dir /app/importer
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 IMPORTER_HTTP_ADDR=0.0.0.0:8081 \
    GARMIN_TOKEN_ROOT=/var/lib/health-hub/garmin GARMIN_OUTPUT_ROOT=/var/lib/health-hub/activities \
    HOME=/tmp
USER 10002:10002
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=4 \
    CMD python -c "import socket; socket.create_connection(('127.0.0.1', 8081), 3).close()"
ENTRYPOINT ["health-hub-garmin-control"]
