---
prompt_id: "PROMPT-CHORE-662-IDENTIFICADORES-NAVA-AGENDA-v1"
version: "1.0"
kind: "chore"
status: "executed"
target_agents:
  - "claude-code"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: null
related_hu: []
issue: 662
issue_url: "https://github.com/bcaceres19/barberia/issues/662"
suggested_issue_title: null
branch: "refactor/662-identificadores-nava-agenda"
pr: null
pr_url: null
depends_on:
  - "DEC-183"
  - "#660"
  - "#661"
rules:
  - "RN-TEN-01"
decisions:
  - "DEC-183"
acceptance_criteria: []
source_docs:
  - "AGENTS.md"
  - "docs/10-backlog/prompts/orchestration/nava-agenda.md"
  - "docs/03-desarrollo/estrategia-pruebas.md"
created_at: "2026-11-18"
updated_at: "2026-11-18"
supersedes: null
superseded_by: null
---

# Identificadores Go y Vue de Nava Agenda (#662, `DEC-183`)

## Instrucción para el agente

Entrega 7 de [PROMPT-ORCH-NAVA-AGENDA-v1](../orchestration/nava-agenda.md). Rama `refactor/662-identificadores-nava-agenda`, creada desde `main` con #660 y #661 ya integrados (esquema `business`/`professional`, contrato HTTP 1.0.0). Refactor **sin cambio de comportamiento** salvo las redirecciones y la cookie descritas abajo. Un solo PR.

## Objetivo

El código deja de nombrar barberías y barberos: módulo Go, paquetes, archivos, tipos, funciones, variables, constantes, componentes, módulos y rutas del panel usan `business`/`professional` (en español en la UI y rutas: «negocio»/«profesional»).

## Preflight obligatorio

1. Leer `AGENTS.md`, `docs/03-desarrollo/estrategia-pruebas.md` y la sección `DEC-183` de `docs/00-control/registro-decisiones.md`.
2. Inventariar con `git grep -niE "barber"` en `apps/api`, `apps/web/src`, `apps/web/e2e`, `tools`, `database/testdata`, `database/seeds` y `database/tests`.

## Alcance incluido

- **Módulo Go** `system-barbershop` → `nava-agenda` (`go.mod` y todas las importaciones). Paquetes, archivos `*barber*`, tipos (`BarbershopID` → `BusinessID`, `BarberID` → `ProfessionalID`…), funciones, variables, constantes (`StatusCancelledByBarber` → `StatusCancelledByProfessional`…), nombres de pruebas y claves de log.
- **Web**: módulos, componentes, composables, archivos y tipos internos (`barberServices` → `professionalServices`, `barberId` → `professionalId` en los modelos del panel…). Los mapeos que traducían el contrato nuevo a nombres internos viejos se simplifican. `package.json` `name` `@system-barbershop/web` → `@nava-agenda/web`.
- **Rutas del panel**: `/panel/barberia` → `/panel/negocio`, `/panel/barberia/google-calendar` → `/panel/negocio/google-calendar`, `/panel/barberia/google-calendar/callback` → `/panel/negocio/google-calendar/callback`, y cualquier otra ruta con «barberia»/«barbero». Nombres de ruta (`configuracion-barberia` → `configuracion-negocio`…). **Las rutas viejas redirigen a las nuevas conservando query y hash**: el retorno de Google Calendar registrado en producción sigue llegando a `/panel/barberia/google-calendar/callback?code=…&state=…` hasta que el propietario cambie la URI; añade prueba de router de que esa redirección conserva `code` y `state`.
- **Cookie de sesión** `barberia_session` → `nava_agenda_session`. Para no cerrar sesiones abiertas: el API lee la nueva y, si falta, la vieja; al iniciar o renovar sesión escribe la nueva y borra la vieja; al cerrar sesión borra ambas. Pruebas de handler de los tres casos. Actualiza OpenAPI (`ClearCookieSession`, `SetCookieSession`, `securitySchemes`) y su CHANGELOG (1.1.0, cambio compatible).
- `slugFallback "barberia"` → `"negocio"` (solo afecta slugs nuevos; los existentes no cambian).
- Operaciones de idempotencia `cancel_appointment_by_barber`, `create_barber` y similares → `…_professional` (las claves en vuelo caducan solas; documéntalo en el commit).
- Fixtures, seeds y suites SQL: identificadores de pruebas y comentarios con nombres de código; **no** cambies datos de ejemplo visibles ni el vocabulario («barbería» como término elegido por un negocio sigue siendo válido).
- `tools/` (QA, CI) donde nombren paquetes, módulo o rutas.
- `.agents/skills/local-app-startup/SKILL.md`: la comprobación usa `GET /api/v1/private/barbers`, que ya no existe; cámbiala a `/api/v1/private/professionals` y ejecuta `tools/ai/validate-agent-system.sh --strict` (debe terminar sin fallos ni advertencias).

## Fuera de alcance

- Contrato HTTP de rutas y campos (#661, ya integrado), salvo la cookie. Los alias deprecados de Odin y `barberName`/`barberId` **se quedan**.
- Esquema de base de datos y migraciones aplicadas (inmutables).
- Documentación en `docs/` salvo historial y este prompt (#663). Decisiones, historial y prompts ejecutados no se reescriben.
- Nombres de imágenes Docker, proyecto compose, rutas `/srv/barberia`, repositorio y Jenkins (#664).
- Plantillas de WhatsApp (`DEC-183`).

## Estado existente que debe conservarse

- Sesiones abiertas, enlaces públicos `/reservar/<slug>` y `/reservar/<slug>/mi-turno/<ref>`, OTP, Google Calendar (la URI vieja sigue funcionando por la redirección).
- Ningún texto visible cambia (ya lo hizo #659), salvo que encuentres «barbería» fijo que no sea vocabulario del negocio: anótalo en el informe, no lo cambies.
- Nunca imprimir valores de `.env*` ni secretos.

## Trabajo requerido

1. Go primero: renombrado mecánico con herramientas que respeten el AST cuando puedas (`gofmt -r`, `gopls rename` si está disponible, o `sed` acotado y verificado por compilador). `go build ./...`, `go vet ./...`, `gofmt -l` vacío.
2. Web: renombrado de archivos con `git mv`, importaciones, `npm run typecheck` (`vue-tsc -b`), `npm run lint`, `npm run format`, `npx vitest run`.
3. Redirecciones del panel y cookie con sus pruebas.

## Pruebas y evidencia

- Suite Go completa contra PostgreSQL efímero en el puerto **55436**: `docker run -d --rm --name ci662-pg --network host -e POSTGRES_PASSWORD=postgres postgres:16 -c port=55436`. Copia `tools/ci/checks/go.sh` a un temporal sustituyendo `localhost:5432` por `localhost:55436`, añadiendo `PGPORT=55436` al `export PGHOST=…`, fijando el `cd` inicial a la raíz del worktree y quitando `govulncheck` (y `-race` si hace falta). Lo mismo con `tools/ci/checks/database.sh`. Ambos en 0; al terminar `docker rm -f ci662-pg`.
- Shellcheck exacto del CI: `tools/ci/checks/shellcheck.sh` (puedes correrlo con la imagen `koalaman/shellcheck-alpine:stable`).
- Vitest completo, typecheck, lint y format en `apps/web`.

## Documentación y trazabilidad

- Fila nueva en `docs/00-control/historial-cambios.md` (sube la versión del frontmatter).
- `api/openapi/CHANGELOG.md` por la cookie.
- Al terminar, este prompt pasa a `executed` y su fila en `docs/10-backlog/prompts/README.md` también.

## Verificación final

- `git grep -niE "barber" -- apps tools database/testdata database/seeds database/tests ':!apps/web/src/shared/api/generated'` solo devuelve: alias deprecados de Odin y sus pruebas, el vocabulario de ejemplo («barbería» como término de un negocio), la lectura de la cookie vieja y las redirecciones de rutas viejas. Lista el resto en el informe con su motivo.
- Go, SQL, shellcheck, vitest, typecheck, lint y format verdes.

## Git y PR

- Commits Conventional (`refactor(api): …`, `refactor(web): …`) con el pie `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` desde la raíz del worktree.
- Sin force push ni rebase. Puedes hacer `git push -u origin refactor/662-identificadores-nava-agenda`; el PR lo abre quien te lanzó.
