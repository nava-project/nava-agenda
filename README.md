# Nava Agenda

Agenda de citas web para negocios de servicios: barberías, salones, consultorios y estudios. Cada negocio publica sus servicios y profesionales, recibe reservas en línea sin cruces de horario y conserva el historial de cada cita. En producción está en [agenda.nava.wtf](https://agenda.nava.wtf).

**La documentación no vive aquí.** Las decisiones (`DEC-*`), las reglas, las historias, la arquitectura, los runbooks y las evidencias están en la bóveda de Nava: [`nava-project/nava-docs` → `agenda/`](https://github.com/nava-project/nava-docs/tree/main/agenda). Localmente, es el clon hermano `../nava-docs/agenda`.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `apps/api` | Backend Go: procesos `api` y `worker` |
| `apps/web` | Frontend Vue 3 + TypeScript + Vite |
| `database` | Migraciones Atlas, roles, seeds, testdata y suites SQL |
| `api/openapi` | Contrato HTTP (OpenAPI 3.1, contract-first) |
| `deploy` | Compose, Caddy y scripts de producción |
| `tools/ci` | Checks del CI (Jenkins), que se corren en local con `tools/ci/run.sh` |

## Correrlo en local

Requiere Docker, Go, Node.js con pnpm y Atlas.

```bash
# 1. PostgreSQL y migraciones (DATABASE_URL apunta a la base local con el rol migrador)
cd database && atlas migrate apply --env local

# 2. API en :8080 (con APP_DATABASE_URL y APP_AUTH_HMAC_SECRET en el entorno)
cd apps/api && go run ./cmd/api

# 3. Frontend en :5173
cd apps/web && pnpm install && pnpm dev
```

Las pruebas son las mismas que corre el CI: `tools/ci/run.sh go --postgres`, `tools/ci/run.sh database --postgres`, `tools/ci/run.sh web-test` y `tools/ci/run.sh web-static`. La guía completa de arranque, con los roles y las variables, es el skill [`local-app-startup`](.agents/skills/local-app-startup/SKILL.md).

Para contribuir, sigue [`AGENTS.md`](AGENTS.md).
