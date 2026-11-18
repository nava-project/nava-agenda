---
prompt_id: "PROMPT-DOCS-663-DOCUMENTACION-NAVA-AGENDA-v1"
version: "1.0"
kind: "docs"
status: "executed"
target_agents:
  - "claude-code"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: null
related_hu: []
issue: 663
issue_url: "https://github.com/bcaceres19/barberia/issues/663"
suggested_issue_title: null
branch: "docs/663-documentacion-nava-agenda"
pr: null
pr_url: null
depends_on:
  - "DEC-183"
  - "#660"
  - "#661"
  - "#662"
rules: []
decisions:
  - "DEC-183"
acceptance_criteria: []
source_docs:
  - "AGENTS.md"
  - "docs/10-backlog/prompts/orchestration/nava-agenda.md"
  - "docs/00-control/registro-decisiones.md"
created_at: "2026-11-18"
updated_at: "2026-11-18"
supersedes: null
superseded_by: null
---

# Documentación vigente de Nava Agenda (#663, `DEC-183`)

## Instrucción para el agente

Entrega 8 de [PROMPT-ORCH-NAVA-AGENDA-v1](../orchestration/nava-agenda.md). Rama `docs/663-documentacion-nava-agenda` desde `main`, que ya tiene integrados el esquema (#660), el contrato HTTP 1.0.0/1.1.0 (#661) y los identificadores Go/Vue (#662). Solo documentación: no cambies código, pruebas, migraciones ni `deploy/` (eso es #664).

## Objetivo

La documentación **vigente** describe el producto como **Nava Agenda**, para cualquier negocio que agenda citas, con los términos «negocio» y «profesional», y con los nombres reales actuales: tablas `business`/`professional`…, variable `app.business_id`, roles `agenda_*`, rutas `/public/businesses/…`, `/private/professionals…`, `/panel/negocio`, cookie `nava_agenda_session`, módulo Go `nava-agenda`, dominio `agenda.nava.wtf` (la landing vive en `nava.wtf`, repo `bcaceres19/nava`). La documentación **histórica** no se reescribe.

## Preflight obligatorio

1. Leer `AGENTS.md`, la decisión `DEC-183` en `docs/00-control/registro-decisiones.md` y el prompt de orquestación.
2. Leer `api/openapi/CHANGELOG.md` (equivalencias de rutas y campos), `database/README.md` (fila de `20261121090000`), `docs/05-backend/migraciones-atlas.md` (renombrado de roles) y la fila de #662 en `docs/00-control/historial-cambios.md`.
3. Inventariar: `git grep -c -iE "barber" -- docs README.md CONTRIBUTING.md AGENTS.md apps/api/README.md apps/web/README.md database/README.md .agents`.

## Alcance incluido (vigente: se actualiza)

- `README.md` raíz, `CONTRIBUTING.md`, `apps/api/README.md`, `apps/web/README.md`, `database/README.md` (texto general; la tabla de migraciones describe archivos aplicados: conserva sus nombres y añade solo una nota de equivalencia arriba de la tabla).
- `docs/01-producto/*`, `docs/02-requisitos/*` (incluidas las `HU-*`: el texto de cada historia pasa a negocio/profesional; los identificadores `HU-*`, `RN-*`, `CA-*` no cambian), `docs/03-desarrollo/*`, `docs/04-arquitectura/*`, `docs/05-backend/*` (salvo revisiones fechadas), `docs/06-api/*`, `docs/07-calidad/*` (checklists y metodología vigentes), `docs/10-backlog/plan-bloques.md`.
- `docs/00-control/glosario.md`: términos nuevos y una tabla de equivalencias (barbería → negocio, barbero → profesional, `barbershop` → `business`, `barber` → `professional`, roles, rutas, cookie, módulo, dominio).
- `docs/00-control/matriz-trazabilidad.md`: rutas, tablas, archivos de prueba y fixtures con sus nombres actuales (verifica cada archivo citado con `git ls-files`).
- Skills canónicos en `.agents/skills/*` si nombran tablas, rutas, roles o la cookie viejos; después `tools/ai/validate-agent-system.sh --strict` sin fallos ni advertencias.
- Cada documento modificado con frontmatter `version`/`ultima_actualizacion` sube su versión menor y la fecha `2026-11-18`.

## Fuera de alcance (historia: no se reescribe)

- `docs/00-control/registro-decisiones.md` (solo puedes añadir, en `DEC-183`, una línea que apunte al glosario de equivalencias), `historial-cambios.md` (solo añadir tu fila), `dudas-pendientes.md`, `contradicciones.md`, `supuestos.md` (registros; añade como mucho una nota de equivalencia al principio).
- `docs/10-backlog/prompts/**` (prompts ejecutados; solo actualizas el índice y este prompt), `docs/10-backlog/evidence/**`, `docs/10-backlog/prompt-*.md`, `prompts-detallados-b0.md`, `docs/05-backend/revision-ddl-seguridad-2026-08-11.md` y cualquier informe fechado.
- `api/openapi/**` (ya actualizado), `deploy/**` y `deploy/jenkins/**` (#664), código y pruebas.
- Nombres propios de clientes (p. ej. «Vibras Barbería») y el vocabulario que un negocio puede elegir («barbería»/«barbero» siguen siendo términos válidos de un negocio: DEC-110).

## Estado existente que debe conservarse

- Identificadores de reglas, historias, decisiones y criterios.
- Enlaces internos: si renombras un ancla o un título citado desde otros documentos, actualiza los enlaces; no renombres archivos de `docs/` salvo que el nombre contenga «barber» y sea vigente, y en ese caso actualiza todos los enlaces (`git grep` del nombre viejo debe quedar vacío fuera de la historia).
- Ningún dato personal real, secreto ni correo real.

## Trabajo requerido

1. Reescribir con criterio, no con sustitución ciega: concordancia de género («el negocio», «la profesional/el profesional» según contexto, «los profesionales»), frases naturales, y conservando el sentido normativo.
2. Donde un documento vigente describe una tabla, ruta, rol o archivo, usar el nombre real actual (compruébalo en el código de `main`).
3. Comprobar enlaces relativos de los archivos tocados (que el destino exista).

## Pruebas y evidencia

- `tools/ai/validate-agent-system.sh --strict` en 0 si tocaste `.agents`, `AGENTS.md` o `CLAUDE.md`.
- Comprobación de enlaces: script temporal que, para cada `[texto](ruta)` relativo de los archivos tocados, verifique que el archivo existe.
- Si el CI tiene un check de documentación (mira `tools/ci/checks/` y `tools/ci/plan.sh`), córrelo.

## Documentación y trazabilidad

- Fila nueva en `docs/00-control/historial-cambios.md` (sube su versión) con la lista de documentos y la regla aplicada (vigente vs historia).
- Este prompt pasa a `executed` y su fila del índice `docs/10-backlog/prompts/README.md` también.

## Verificación final

- `git grep -n -iE "barber" -- docs README.md CONTRIBUTING.md AGENTS.md apps/api/README.md apps/web/README.md database/README.md .agents` solo devuelve archivos de historia (lista de arriba), equivalencias del glosario, nombres de migraciones aplicadas, alias deprecados de Odin, nombres propios y el vocabulario elegible. Incluye ese resumen en tu informe.

## Git y PR

- Commits Conventional (`docs: …`) con el pie `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` desde la raíz del worktree; un commit por grupo de documentos para que sea revisable.
- Sin force push ni rebase. Puedes hacer `git push -u origin docs/663-documentacion-nava-agenda`; el PR lo abre quien te lanzó.
