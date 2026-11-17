---
prompt_id: "PROMPT-OPS-ODIN-ENLACE-SIN-PROPOSITO-v1"
version: "1.0"
kind: "ops"
status: "draft"
target_agents:
  - "claude"
  - "codex"
repository: "externo — bcaceres19/odin (no modifica bcaceres19/barberia)"
base_branch: "main"
primary_hu: null
related_hu:
  - "HU-105"
  - "HU-106"
issue: "pending"
issue_url: null
suggested_issue_title: "feat(eye-nava): pedir el código del turno sin propósito y pegar el accessUrl que devuelve NAVA"
branch: null
pr: null
pr_url: null
depends_on:
  - "bcaceres19/barberia#651 (DEC-181, OpenAPI 0.58.0) integrado en main y desplegado en nava.wtf"
rules:
  - "RN-CAN-01"
  - "RN-DAT-01"
  - "RN-DAT-02"
  - "RN-TEN-01"
decisions:
  - "DEC-179"
  - "DEC-180"
  - "DEC-181"
acceptance_criteria:
  - "CA-106-09"
source_docs:
  - "bcaceres19/barberia: docs/00-control/registro-decisiones.md (DEC-179, DEC-180, DEC-181)"
  - "bcaceres19/barberia: docs/02-requisitos/historias-usuario.md (HU-106)"
  - "bcaceres19/barberia: api/openapi/paths/integrations-odin.yaml y components/schemas/OdinAccessChallenge{Request,Response}.yaml"
  - "bcaceres19/odin: AGENTS.md y la skill .claude/skills/odin-orientacion"
created_at: "2026-11-17"
updated_at: "2026-11-17"
supersedes: null
superseded_by: null
---

# Odin pide el código sin preguntar «¿cancelar o reprogramar?» y pega el enlace de NAVA

## Instrucción para el agente

Trabajas en el repositorio **bcaceres19/odin**, no en `barberia`. Antes de tocar nada, lee `AGENTS.md` y la skill `odin-orientacion` de Odin; sus reglas prevalecen sobre este prompt. Este prompt sigue en `draft` hasta que exista el issue real en `bcaceres19/odin` (título sugerido arriba). Cuando exista, anótalo en `issue` y `issue_url`, pasa `status` a `ready` y actualiza su fila del índice antes de empezar.

Comprueba primero que el cambio de NAVA está desplegado: un `challenge` sin `purpose` contra `https://nava.wtf` debe responder `201` con `purpose: "manage"` y `accessUrl`. Si responde `422`, detente e informa.

## Qué cambió en NAVA (`DEC-181`, OpenAPI 0.58.0, compatible hacia atrás)

`POST /api/v1/integrations/odin/barbershops/{slug}/customer-access/challenge`, con el mismo `Authorization: Bearer` de siempre:

- **Petición:** `{ "phone": "+57…", "appointmentRef": "<de lookup>" }`. `purpose` es **opcional**; sin él vale `manage`. `cancel` y `reschedule` siguen funcionando igual que antes.
- **`manage`:** el turno debe admitir cancelar **o** cambiar la hora (`canCancel || canReschedule` en `lookup`). Si no admite ninguna, el mismo `409` `appointment-not-available`.
- **Respuesta `201`:** `{ accessRef, accessUrl, purpose, expiresAt }`. `accessUrl` es el enlace completo `https://nava.wtf/reservar/<slug>/mi-turno/<accessRef>`; puede faltar si NAVA no tiene web pública configurada (entonces se arma con `accessRef`, como hoy).
- **Página:** abre en «02 Código» con «01 Contacto» marcado como hecho; tras el código, «03 Tu turno» muestra el turno con «Cambiar la hora» y «Cancelar turno». La persona elige allí.
- Sin cambios: `lookup`, el código por WhatsApp (`nava_codigo_turno`), su vigencia de 10 minutos, los 5 intentos, los límites (`429` con `Retry-After`) y el `503` sin WhatsApp.

## Qué hacer en Odin

1. Tras `lookup` y la confirmación del cliente («sí, es esa cita»), llama a `challenge` **sin** `purpose` (o con `manage`). Ya no preguntes si quiere cancelar o reprogramar antes de dar el enlace. Si el cliente ya dijo de entrada qué quiere, puedes seguir enviando `cancel` o `reschedule`; documenta en el PR qué criterio elegiste.
2. Usa `accessUrl` tal cual en la respuesta fija. Si falta, arma `f"{booking_base_url}/reservar/{slug}/mi-turno/{accessRef}"` como hasta ahora. El modelo nunca escribe la URL (I3).
3. El texto de la respuesta: el código llega a ese mismo WhatsApp, el enlace vence en 10 minutos y en la página elige si cambia la hora o cancela. No afirmes que se canceló, movió ni confirmó nada; no prometas cupo; no inventes plazos.
4. Un turno con `canCancel` y `canReschedule` en `false` no recibe enlace: dile que ya no se puede cambiar por aquí y que hable con la barbería.
5. Ajusta las verificaciones de salida (`grounding`, `rewrite_guard`, `voice_check`) solo para la plantilla nueva, como ya se hace con las demás plantillas fijas.

## Fuera de alcance

- Cualquier cambio en `bcaceres19/barberia` o en la API de NAVA.
- Ver, pedir o reenviar el código, el `accessToken` o datos del cliente.
- Que Odin cancele o mueva el turno por su cuenta.

## Pruebas obligatorias

Ruff, mypy y pytest en verde, según `AGENTS.md` de Odin.

- El cliente que confirma su cita recibe el enlace sin una pregunta intermedia, y la petición a NAVA no lleva `purpose` (o lleva `manage`).
- La respuesta contiene exactamente `accessUrl` (o el enlace armado con `accessRef` si falta) y ninguna otra URL.
- `409`, `429` y `503` producen sus respuestas fijas actuales.
- Un turno sin acciones disponibles no dispara `challenge`.
- Lote corto con la skill `odin-probar-conversaciones`, con conversaciones **sintéticas**.

## Entrega

- Rama corta en `bcaceres19/odin` desde `main` actualizada, Conventional Commits y PR que cite el issue de Odin y `bcaceres19/barberia#651`.
- No despliegues sin autorización explícita del propietario.
- Al terminar, actualiza en `barberia` este prompt (`status`, `issue`, `branch`, `pr`) y su fila en `docs/10-backlog/prompts/README.md`.
