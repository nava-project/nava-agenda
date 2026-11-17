---
prompt_id: "PROMPT-HU-104-v1"
version: "1.0"
kind: "hu"
status: "in_progress"
target_agents:
  - "claude"
  - "codex"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: "HU-104"
related_hu:
  - "HU-065"
  - "HU-094"
  - "HU-098"
  - "HU-099"
  - "HU-105"
issue: 636
issue_url: "https://github.com/bcaceres19/barberia/issues/636"
suggested_issue_title: null
branch: "feat/636-hu104-reprogramacion-cliente"
pr: null
pr_url: null
depends_on:
  - "HU-065 integrada"
  - "HU-094 integrada"
  - "HU-098 integrada"
  - "HU-099 integrada"
  - "DEC-178"
rules:
  - "RN-RES-03"
  - "RN-CAN-01"
  - "RN-CIT-01"
  - "RN-CON-01"
  - "RN-HIS-01"
  - "RN-IDE-01"
  - "RN-TEN-01"
decisions:
  - "DEC-043"
  - "DEC-076"
  - "DEC-083"
  - "DEC-089"
  - "DEC-102"
  - "DEC-142"
  - "DEC-144"
  - "DEC-178"
acceptance_criteria:
  - "CA-104-01"
  - "CA-104-02"
  - "CA-104-03"
  - "CA-104-04"
  - "CA-104-05"
  - "CA-104-06"
  - "CA-104-07"
  - "CA-104-08"
source_docs:
  - "AGENTS.md"
  - "CLAUDE.md"
  - "docs/00-control/registro-decisiones.md"
  - "docs/02-requisitos/historias-usuario.md"
  - "docs/01-producto/reglas-negocio.md"
  - "docs/03-desarrollo/estandar-diseno-visual.md"
  - "docs/03-desarrollo/estrategia-pruebas.md"
  - "docs/06-api/estandar-openapi.md"
created_at: "2026-11-17"
updated_at: "2026-11-17"
supersedes: null
superseded_by: null
---

# HU-104 · El cliente reprograma su turno desde el enlace

## Instrucción para el agente

Implementa únicamente `HU-104` según `DEC-178`. Trabaja de forma autónoma hasta abrir el PR con pruebas y evidencia; no implementes el acceso por código (`HU-105`).

## Objetivo

Quien pidió el turno abre `/mi-turno/<token>`, pulsa «Reprogramar» y llega a una pantalla dedicada (`/mi-turno/<token>/reprogramar`). Allí elige otro día y hora del mismo profesional y confirma. El turno se mueve en el servidor con las reglas de `DEC-178`.

## Preflight obligatorio

1. Árbol limpio, `main` actualizada por fast-forward, rama `feat/636-hu104-reprogramacion-cliente`.
2. Lee `DEC-178`, `HU-104`, `HU-065`, `HU-098` y `HU-099` completas.
3. Si encuentras una contradicción con una `RN-*` o `DEC-*`, regístrala antes de codificar.

## Alcance incluido

- **Lectura:** `GET /customer/appointments/{token}` añade `rescheduleRemaining` (0–2), calculado con el historial (`appointment_rescheduled` con actor `customer`).
- **Franjas:** `GET /customer/appointments/{token}/reschedule-slots` devuelve `{ timezone, starts[] }`. Usa el mismo profesional, la duración del snapshot y la misma función de disponibilidad de `HU-094` (`computeAvailableStarts`), quitando de los ocupados el intervalo del propio turno. Si el turno no está `confirmed`, la lista es vacía.
- **Reprogramar:** `POST /customer/appointments/{token}/reschedule` con `If-Match` (versionToken), `Idempotency-Key` y cuerpo `{ "startsAt": "<instante RFC 3339>" }`. En el servicio:
  - El inicio debe estar entre las franjas ofrecidas; si no, `slot-unavailable` (409).
  - Dentro de una transacción con la fila bloqueada:
    - Comprueba la versión y que el turno esté `confirmed`.
    - Comprueba el plazo con `cancellation_deadline_minutes` y el reloj del servidor; fuera de plazo, `reschedule-window-closed` (422).
    - Comprueba que el cliente haya reprogramado menos de 2 veces; si no, `reschedule-limit-reached` (422).
    - Si el intervalo es el mismo, no hace nada.
    - Si cambia, actualiza el intervalo (la exclusión de PostgreSQL responde 409), registra `appointmentChanged` y `reminderRequired` y escribe el historial con actor `customer`.
    - **No** registra `noticeRequired`.
- **Puertos:**
  - `booking` declara el puerto de franjas y `publicbooking` lo implementa.
  - `customeraccess` habla con `booking` y `publicbooking` solo por puertos que se cablean en `cmd/api` (como en `HU-099`).
- **Contrato:** OpenAPI contract-first (nueva versión menor), cliente tipado generado y traducción de los dos tipos de problema nuevos.
- **Interfaz:** botón en la pantalla del turno (solo si `rescheduleRemaining > 0`, el turno está `confirmed` y no venció el plazo) y página dedicada. La página tiene:
  - el turno actual;
  - días y horarios agrupados por fecha civil de la barbería;
  - un resumen «antes → ahora»;
  - confirmación explícita;
  - estados de éxito, conflicto (recarga las franjas), fuera de plazo, límite, carga, error con reintento y enlace inválido.

  Usa la identidad NAVA / Tailored Grid de la reserva pública (`BookingBackdrop`, tinta y marca de la barbería) sin mockup asignado (`DEC-078`).

## Fuera de alcance

- Código de un solo uso, búsqueda por correo o teléfono (`HU-105`).
- Cambiar servicio o profesional, avisar al barbero, plazo o límite configurables.

## Estado existente que debe conservarse

- `RescheduleService` del barbero (`HU-065`) sigue igual, con su aviso al cliente (`DEC-142`).
- Cancelación del cliente (`HU-099`) y reseñas (`HU-100`) sin cambios de comportamiento.
- `ListPublicAvailability` y la confirmación pública (`HU-097`) no cambian de resultado.

## Pruebas y evidencia

- Go, dominio: el plazo (límite inclusivo, plazo 0, turno ya iniciado) y el límite.
- Go, servicio: con puertos simulados (franja no ofrecida, token inválido).
- Go, HTTP: cabeceras, cuerpo estricto, tipos de problema y `no-store`.
- PostgreSQL real con dos tenants:
  - mover, no-op, historial con actor cliente, recordatorio regenerado, sin aviso y sincronización con Google encolada;
  - límite, plazo y versión;
  - carrera por la misma franja;
  - aislamiento entre tenants.
- Vitest: modelo de disponibilidad de la reprogramación y componente de la página (selección, confirmación, conflicto y límite).
- Playwright con el API simulado: recorrido completo y evidencia a 320/360/768/1280 px con axe-core.

## Documentación y trazabilidad

- `historias-usuario.md` (estado de `HU-104`), `matriz-trazabilidad.md`, `historial-cambios.md`, OpenAPI y este catálogo.
- Si alguna migración aparece (no se espera ninguna), añádela a `tools/ci/checks/go.sh`.

## Verificación final

```text
cd apps/api && go vet ./... && go test ./...   (con PostgreSQL efímera)
cd apps/web && npm run lint && npm run typecheck && npm run test -- --run
npx playwright test e2e/cliente-reprogramacion-turno.spec.ts
```

Entrega la tabla `Criterio | Estado | Prueba o evidencia`.

## Git y PR

- Commit/PR: `feat(customer-access): el cliente reprograma su turno desde el enlace (HU-104)`.
- `Closes #636`.
