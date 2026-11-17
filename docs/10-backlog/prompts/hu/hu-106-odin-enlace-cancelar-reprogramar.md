---
prompt_id: "PROMPT-HU-106-v1"
version: "1.0"
kind: "hu"
status: "in_progress"
target_agents:
  - "claude"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: "HU-106"
related_hu:
  - "HU-104"
  - "HU-105"
  - "HU-098"
issue: 645
issue_url: "https://github.com/bcaceres19/barberia/issues/645"
suggested_issue_title: null
branch: "feat/645-hu106-odin-enlace-cancelar-reprogramar"
pr: null
pr_url: null
depends_on:
  - "HU-104 y HU-105 integradas"
  - "DEC-178"
  - "DEC-179"
rules:
  - "RN-CAN-01"
  - "RN-DAT-01"
  - "RN-DAT-02"
  - "RN-DAT-03"
  - "RN-TEN-01"
decisions:
  - "DEC-062"
  - "DEC-089"
  - "DEC-123"
  - "DEC-141"
  - "DEC-178"
  - "DEC-179"
acceptance_criteria:
  - "CA-106-01"
  - "CA-106-02"
  - "CA-106-03"
  - "CA-106-04"
  - "CA-106-05"
  - "CA-106-06"
  - "CA-106-07"
  - "CA-106-08"
source_docs:
  - "AGENTS.md"
  - "CLAUDE.md"
  - "docs/00-control/registro-decisiones.md"
  - "docs/02-requisitos/historias-usuario.md"
  - "docs/05-backend/estandar-base-datos.md"
  - "docs/05-backend/migraciones-atlas.md"
  - "docs/06-api/estandar-openapi.md"
  - "docs/03-desarrollo/estrategia-pruebas.md"
created_at: "2026-11-17"
updated_at: "2026-11-17"
supersedes: null
superseded_by: null
---

# HU-106 · Odin entrega el enlace para cancelar o reprogramar el turno por WhatsApp

## Instrucción para el agente

Implementa únicamente `HU-106` según `DEC-179`, sobre `HU-104` y `HU-105` ya integradas. No cambies las reglas de cancelación ni de reprogramación.

## Objetivo

Odin, el asistente de WhatsApp, encuentra los turnos del cliente por el teléfono que Meta firma, confirma con él cuál es y pide un código atado a ese turno. El cliente lo escribe en `/reservar/<slug>/mi-turno/<accessRef>` y llega a «Mi turno» (cancelar) o a «Cambiar la hora» (reprogramar).

## Preflight obligatorio

1. Comprueba que `HU-104` y `HU-105` están integradas en `main`.
2. Cambia el estado a `in_progress` y crea la rama `feat/645-hu106-odin-enlace-cancelar-reprogramar`.
3. Lee `DEC-178`, `DEC-179`, `HU-105` y el módulo `customeraccess`.

## Alcance incluido

- **Migración Atlas:** tres columnas en `customer_access_challenge` (turno, propósito, hash de la referencia del enlace), con clave foránea compuesta y un `CHECK` que las exige juntas y solo con cliente. Registrada en `tools/ci/checks/go.sh`.
- **Acceso de servicio:** `APP_ODIN_SERVICE_TOKEN` (mínimo 32 caracteres, distinto de los secretos de Meta); sin él, las rutas no se montan.
- **API:** `lookup` y `challenge` de Odin, `verify-ref` público, `429`, `409 appointment-not-available` y `503`.
- **Interfaz:** página de la referencia y el destino por propósito; la pantalla general de `HU-105` lleva a `/mi-turno/<token>`.

## Fuera de alcance

- Que Odin vea el código o el acceso, SMS y cambios a las políticas de cancelación o de reprogramación.

## Pruebas y evidencia

- Dominio: referencia cifrada. PostgreSQL real con dos tenants: aislamiento, un solo uso, intentos, límites y tope por barbería. HTTP y contrato. Configuración. Componente y E2E con evidencia a 320/360/768/1280 px y axe-core.

## Documentación y trazabilidad

- OpenAPI 0.57.0, `database/README.md`, `deploy/README.md`, `matriz-trazabilidad.md`, `historial-cambios.md`, `historias-usuario.md` y este catálogo.

## Git y PR

- Commit/PR: `feat(customer-access): Odin entrega el enlace para cancelar o reprogramar por WhatsApp (HU-106)`.
- `Closes #645`.
