# Imagen de herramientas del CI en Jenkins (DEC-177): reúne en una sola imagen lo que
# los runners de GitHub Actions instalaban en cada job (Go, Node 20 + pnpm 10, cliente
# psql, Atlas fijado y shellcheck). Jenkins la construye en la VPS y la etiqueta por el
# hash de este archivo (tools/ci/run.sh), así que solo se reconstruye cuando cambia.
# Contexto de construcción: cualquiera (no copia archivos del repositorio).

FROM node:20-trixie-slim AS node

FROM golang:1.26-trixie

# Debe coincidir con ATLAS_VERSION de nava-docs/agenda/05-backend/migraciones-atlas.md §3.3 y con
# deploy/docker/db.Dockerfile.
ARG ATLAS_VERSION=v1.3.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client shellcheck \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSfL "https://release.ariga.io/atlas/atlas-linux-amd64-${ATLAS_VERSION}" -o /usr/local/bin/atlas \
    && chmod 0755 /usr/local/bin/atlas \
    && atlas version

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && npm install -g pnpm@10 \
    && node --version && pnpm --version

# Las pruebas corren con el UID de Jenkins (1000) para que los archivos que dejan en el
# workspace sean suyos. /cache es un volumen con nombre compartido entre ejecuciones
# (módulos y build de Go; el almacén de pnpm vive en $HOME): nace con este dueño al montarse vacío.
RUN mkdir -p /cache/home /cache/go /cache/go-build \
    && chown -R 1000:1000 /cache
ENV HOME=/cache/home \
    GOPATH=/cache/go \
    GOMODCACHE=/cache/go/pkg/mod \
    GOCACHE=/cache/go-build \
    GOFLAGS=-buildvcs=false \
    CI=true
