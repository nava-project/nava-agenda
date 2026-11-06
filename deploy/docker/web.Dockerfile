# syntax=docker/dockerfile:1
# Imagen web: compila la SPA de Vue y la sirve con Caddy, que además termina
# TLS (Let's Encrypt automático) y reenvía /api/* al backend (mismo origen,
# como declara el contrato OpenAPI: `servers: /api/v1`).
# Contexto de construcción: la raíz del repositorio.

FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /src
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY apps/web/ ./
# Clave de NAVEGADOR de Google Maps: es pública por diseño y se protege con la
# restricción por dominio en Google Cloud, no ocultándola del bundle.
ARG VITE_GOOGLE_MAPS_BROWSER_KEY=""
ENV VITE_GOOGLE_MAPS_BROWSER_KEY=$VITE_GOOGLE_MAPS_BROWSER_KEY
RUN pnpm run build

FROM caddy:2-alpine
# Caddy corre sin privilegios (UID 10002). Sus certificados y su configuración
# viven en rutas propias —no en /data ni /config, que la imagen base declara
# como VOLUME y cuyos cambios de propietario se descartarían— para que los
# volúmenes con nombre nazcan con el dueño correcto.
RUN mkdir -p /var/lib/nava-caddy/data /var/lib/nava-caddy/config \
    && chown -R 10002:10002 /var/lib/nava-caddy
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
