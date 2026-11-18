---
prompt_id: "PROMPT-ORCH-NAVA-AGENDA-v1"
version: "1.0"
kind: "orchestration"
status: "in_progress"
target_agents:
  - "any"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: null
related_hu: []
issue: 656
issue_url: "https://github.com/bcaceres19/barberia/issues/656"
suggested_issue_title: null
branch: "docs/656-nava-agenda"
pr: null
pr_url: null
depends_on:
  - "DEC-183"
rules:
  - "RN-TEN-01"
decisions:
  - "DEC-183"
  - "DEC-036"
  - "DEC-176"
  - "DEC-177"
acceptance_criteria: []
source_docs:
  - "AGENTS.md"
  - "docs/00-control/registro-decisiones.md"
  - "deploy/README.md"
  - "deploy/jenkins/README.md"
  - "docs/05-backend/migraciones-atlas.md"
  - "docs/06-api/estandar-openapi.md"
created_at: "2026-11-18"
updated_at: "2026-11-18"
supersedes: null
superseded_by: null
---

# Orquestación · Nava Agenda (`DEC-183`)

## Instrucción para el agente

Ejecuta las entregas en el orden de la tabla, una rama y un PR por issue, sin mezclar preocupaciones. Antes de cada una, comprueba que la anterior está integrada y desplegada. Cada PR se integra por squash con el CI de Jenkins en verde.

## Objetivo

El producto se llama Nava Agenda, usa «negocio» y «profesional», vive en `agenda.nava.wtf` y no conserva el nombre «barbería» ni en la interfaz, ni en la base de datos, ni en el contrato, ni en el código, ni en el repositorio. `nava.wtf` sirve la landing de la familia NAVA desde un repositorio aparte.

## Orden

| # | Issue | Entrega | Depende de | Riesgo principal |
| - | ----- | ------- | ---------- | ---------------- |
| 1 | [#656](https://github.com/bcaceres19/barberia/issues/656) | `DEC-183` y este plan | — | Ninguno |
| 2 | [#657](https://github.com/bcaceres19/barberia/issues/657) | App en `agenda.nava.wtf` (Caddy, URL pública, Google, Maps) | DNS A `agenda` | Certificado sin DNS; URI de Google Calendar |
| 3 | [#658](https://github.com/bcaceres19/barberia/issues/658) | Landing y legales en `bcaceres19/nava`; `nava.wtf` la sirve y redirige las rutas de la app | 2 | Enlaces viejos de Vibras, Odin y Google |
| 4 | [#659](https://github.com/bcaceres19/barberia/issues/659) | Textos: Nava Agenda, negocio, profesional | 3 | Pruebas que buscan texto |
| 5 | [#660](https://github.com/bcaceres19/barberia/issues/660) | Esquema: tablas, columnas, políticas, funciones, GUC y roles | 4 | Datos de producción; DSN con el nombre del rol |
| 6 | [#661](https://github.com/bcaceres19/barberia/issues/661) | Contrato HTTP `businesses`/`professionals` (OpenAPI 1.0.0) | 5 | Odin; alias temporal de sus rutas |
| 7 | [#662](https://github.com/bcaceres19/barberia/issues/662) | Identificadores Go y Vue; módulo `nava-agenda` | 6 | Diff enorme; conflictos |
| 8 | [#663](https://github.com/bcaceres19/barberia/issues/663) | Documentación vigente | 7 | Reescribir historia por error |
| 9 | [#664](https://github.com/bcaceres19/barberia/issues/664) | Repositorio, Jenkins, imágenes, servidor y carpeta local | 8 | Webhook, rutas de `/srv`, volúmenes |

## Acciones externas (las hace el propietario o requieren su permiso)

- DNS en Hostinger: registro A `agenda` → `158.69.232.180` (bloquea la entrega 2).
- Google Cloud: URI de redirección de Google Calendar en `agenda.nava.wtf` y referrers de la clave de navegador de Maps (`https://agenda.nava.wtf/*`). Editar claves con `gcloud` requiere permiso explícito.
- Odin (`bcaceres19/odin`): cambiar su URL base a `https://agenda.nava.wtf/api/v1` y, tras la entrega 6, las rutas y campos nuevos. Se coordina con la sesión de Odin; abrir issues en su repositorio requiere aprobación.
- Plantillas de WhatsApp: no se renombran (`DEC-183`, fuera de alcance).

## Reglas por entrega

- **Base de datos (5).** Una sola migración nueva con `ALTER … RENAME`; nada de copiar datos. Respaldo antes del despliegue (lo hace `deploy.sh`). `ALTER ROLE … RENAME` conserva contraseñas SCRAM; verificar que ninguna sea MD5. Los DSN de `/srv/barberia/secrets` y del CI cambian de usuario en el mismo despliegue. El SQL embebido en Go cambia en el mismo PR.
- **Contrato (6).** OpenAPI primero; cliente web regenerado; las rutas de `/integrations/odin/*` conservan un alias con la forma vieja hasta que Odin confirme el cambio.
- **Identificadores (7).** Renombrado mecánico verificado por compilador, `go vet`, `vue-tsc -b` y suites completas; las rutas del panel con «barberia» redirigen a las nuevas.
- **Documentación (8).** No se reescriben decisiones, historial ni prompts ejecutados; se anota la equivalencia de términos.
- **Infraestructura (9).** Renombrar el repositorio en GitHub (redirige la URL vieja), actualizar `jobs.groovy`, webhook y credenciales; la carpeta local se mueve al final, junto con la memoria del agente. Los volúmenes de Docker conservan su nombre físico.

## Verificación global

- `https://agenda.nava.wtf` sirve login, panel y reserva pública de Vibras con datos intactos.
- `https://nava.wtf` sirve la landing, `/privacidad` y `/terminos`; un enlace viejo de reserva redirige.
- Odin responde horarios y turnos contra el API nuevo.
- `git grep -i barber` solo encuentra historia (decisiones, historial, prompts ejecutados, migraciones aplicadas) y nombres propios.
