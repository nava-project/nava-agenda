# syntax=docker/dockerfile:1
# Imagen del backend: contiene los binarios `api` y `worker` (mismo módulo Go,
# DEC-024). Cada servicio de compose elige el suyo con `command`.
# Contexto de construcción: la raíz del repositorio.

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/api/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

FROM alpine:3.22
# tzdata: la agenda trabaja con zonas horarias civiles; ca-certificates: llamadas
# HTTPS salientes (Resend, Meta, Google).
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 nava \
    && adduser -S -u 10001 -G nava -H -s /sbin/nologin nava
COPY --from=build /out/ /usr/local/bin/
USER 10001:10001
ENV TZ=UTC
CMD ["api"]
