---
prompt_id: "PROMPT-CHORE-661-CONTRATO-BUSINESSES-v1"
version: "1.0"
kind: "chore"
status: "in_progress"
target_agents:
  - "claude-code"
repository: "bcaceres19/barberia"
base_branch: "refactor/660-esquema-negocio-profesional"
primary_hu: null
related_hu: []
issue: 661
issue_url: "https://github.com/bcaceres19/barberia/issues/661"
suggested_issue_title: null
branch: "refactor/661-contrato-businesses"
pr: null
pr_url: null
depends_on:
  - "DEC-183"
  - "#660"
rules:
  - "RN-TEN-01"
decisions:
  - "DEC-183"
acceptance_criteria: []
source_docs:
  - "AGENTS.md"
  - "docs/06-api/estandar-openapi.md"
  - "docs/10-backlog/prompts/orchestration/nava-agenda.md"
  - "api/openapi/README.md"
created_at: "2026-11-18"
updated_at: "2026-11-18"
supersedes: null
superseded_by: null
---

# Contrato HTTP con `businesses` y `professionals` (#661, `DEC-183`)

## Instrucción para el agente

Entrega 6 de [PROMPT-ORCH-NAVA-AGENDA-v1](../orchestration/nava-agenda.md). Trabaja en la rama `refactor/661-contrato-businesses`, que parte de `refactor/660-esquema-negocio-profesional` (PR #672, aún sin integrar: el esquema ya usa `business`/`professional`). Un solo PR contra `main`; no lo abras hasta que #672 esté integrado (entonces fusiona `main` en la rama; no hagas rebase ni force push).

## Objetivo

El contrato HTTP deja de nombrar barberías y barberos: rutas, parámetros, campos JSON, esquemas y operaciones usan `business`/`professional`, y el contrato pasa a la versión **1.0.0**. Handler Go, cliente web y pruebas cambian en el mismo PR (contract-first).

## Preflight obligatorio

1. Leer `AGENTS.md`, `docs/06-api/estandar-openapi.md`, `api/openapi/README.md` y `api/openapi/CHANGELOG.md`.
2. Leer la sección `DEC-183` de `docs/00-control/registro-decisiones.md`.
3. Inventariar con `git grep -nE "[Bb]arber"` en `api/openapi`, `apps/api` (handlers `httpapi`, `cmd/api`) y `apps/web/src` (cliente y llamadas).

## Alcance incluido

- Rutas: `/public/barbershops/{slug}/…` → `/public/businesses/{slug}/…`; `/private/barbers…` → `/private/professionals…`; `/barbers/{barberId}` anidado → `/professionals/{professionalId}`; `/private/settings/barbershop` → `/private/settings/business`; `/private/settings/booking-policy/barbers…` → `…/professionals…`; `/private/me/barber` → `/private/me/professional`; `/integrations/odin/barbershops/{slug}/…` → `/integrations/odin/businesses/{slug}/…`.
- Parámetros de ruta, campos JSON de petición y respuesta (`barberId`, `barberName`, `barberFullName`, `barbershopId`, `barbershopName`, `barbershopContactEmail`, `barbershopContactPhone`, `barberLinked`…), nombres de esquemas y respuestas (`BarberResponse` → `ProfessionalResponse`, archivos incluidos) y `operationId` (`listBarbers` → `listProfessionals`…). `paths/barber-services.yaml` → `paths/professional-services.yaml`.
- Valores de datos visibles en el contrato: estado `cancelled_by_barber` → `cancelled_by_professional` y tipo de evento `appointment_cancelled_by_barber` → `appointment_cancelled_by_professional`, con una **migración nueva** posterior a `20261121090000` que actualiza los `CHECK`, las filas existentes (estado de `appointment`, valores del historial, eventos/avisos encolados) y cualquier función que los nombre. Probarla con PostgreSQL real y dos tenants.
- Odin: las rutas viejas `/integrations/odin/barbershops/{slug}/…` siguen respondiendo (alias registrados en el router, marcados `deprecated: true` en OpenAPI o documentados en el CHANGELOG) y la respuesta de `OdinAppointment` incluye `professionalName` **y** el campo viejo `barberName` (marcado `deprecated`), hasta que Odin confirme el cambio.
- `info.title` sin «barberías» (p. ej. «API de Nava Agenda»), `info.version: 1.0.0`, entrada en `CHANGELOG.md` con la tabla de equivalencias.
- Go: rutas de chi, etiquetas `json:"…"`, tabla `access_policy.go`, mensajes de validación que nombran campos, pruebas de handler e integración.
- Web: `npm run generate:api` (tras `pnpm run openapi:bundle` en la raíz), y las llamadas y mapeos del cliente tipado y de los módulos que usan rutas o campos del API. Los identificadores internos Vue/TS que no son del contrato (variables, componentes, rutas del panel) **no** se renombran aquí: son #662.

## Fuera de alcance

- Identificadores Go y Vue internos, módulo `system-barbershop`, rutas `/panel/barberia`, cookie `barberia_session`, `slugFallback` (#662).
- Documentación fuera de `api/openapi` salvo historial y este prompt (#663).
- Plantillas de WhatsApp (no cambian, `DEC-183`).
- Cambiar Odin: solo se mantiene compatible.

## Estado existente que debe conservarse

- Los slugs públicos (p. ej. de Vibras) y los enlaces `/reservar/<slug>/mi-turno/<ref>` siguen funcionando.
- La cookie de sesión y el token de servicio de Odin (`APP_ODIN_SERVICE_TOKEN`) no cambian.
- Nunca imprimir valores de `.env.local` ni secretos.

## Trabajo requerido

1. OpenAPI primero: renombrar, `pnpm run openapi:lint` y `openapi:bundle` sin errores.
2. Migración de valores de datos (Atlas: `atlas migrate hash` con `~/.local/bin/atlas`; añadirla a la lista explícita de `tools/ci/checks/go.sh`).
3. Go: compilar, `go vet`, pruebas.
4. Web: regenerar tipos, `npm run typecheck` (es `vue-tsc -b`, no `--noEmit`), `npm run lint`, `npx vitest run`.

## Pruebas y evidencia

- Suite Go completa contra PostgreSQL efímero: lanzar `docker run -d --rm --name ci661-pg --network host -e POSTGRES_PASSWORD=postgres postgres:16 -c port=55435`, copiar `tools/ci/checks/go.sh` a un archivo temporal sustituyendo `localhost:5432` por `localhost:55435`, añadiendo `PGPORT=55435` al `export PGHOST=…`, fijando el `cd` inicial a la raíz del worktree y quitando `govulncheck` y `-race` si hace falta tiempo; lo mismo con `tools/ci/checks/database.sh`. Ambos deben terminar en 0.
- Prueba de integración de que el alias de Odin responde igual que la ruta nueva y de que la respuesta trae `professionalName` y `barberName`.
- Vitest completo y typecheck en `apps/web`.

## Documentación y trazabilidad

- Fila nueva en `docs/00-control/historial-cambios.md` (sube la versión del frontmatter) y `api/openapi/CHANGELOG.md`.
- Al terminar, actualizar el estado de este prompt (`done`, `pr`) y su fila en `docs/10-backlog/prompts/README.md`.

## Verificación final

- `git grep -nE "[Bb]arber" -- api/openapi ':!api/openapi/CHANGELOG.md'` solo devuelve los alias deprecados de Odin y el campo `barberName` deprecado.
- Go, SQL, vitest y typecheck verdes.

## Git y PR

- Commits Conventional (`refactor(api)!: …`) con el pie `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` desde la raíz del worktree.
- Sin force push. Título del PR: `refactor(api)!: contrato con businesses y professionals`; cuerpo con `Closes #661` y el pie `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
