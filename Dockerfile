FROM node:24-alpine AS web
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
ARG APP_COMMIT
RUN node -e 'require("fs").writeFileSync("dist/deployment.json", JSON.stringify({commit:process.argv[1]}))' "$APP_COMMIT"

FROM golang:1.25-alpine AS api
WORKDIR /build/api
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/health-hub-api ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -o /out/health-hub-migrate ./cmd/migrate

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -g 10001 app && adduser -D -u 10001 -G app app
ARG APP_COMMIT
LABEL org.opencontainers.image.source="https://github.com/domyshev/health" \
      org.opencontainers.image.revision="$APP_COMMIT"
COPY --from=api /out/ /usr/local/bin/
COPY --from=web /build/web/dist/ /app/web/
COPY migrations/ /app/migrations/
ENV STATIC_DIR=/app/web MIGRATIONS_DIR=/app/migrations HTTP_ADDR=:8080
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=4 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["health-hub-api"]
