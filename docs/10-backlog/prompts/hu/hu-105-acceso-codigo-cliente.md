---
prompt_id: "PROMPT-HU-105-v1"
version: "1.0"
kind: "hu"
status: "in_progress"
target_agents:
  - "claude"
  - "codex"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: "HU-105"
related_hu:
  - "HU-104"
  - "HU-007"
  - "HU-098"
issue: 637
issue_url: "https://github.com/bcaceres19/barberia/issues/637"
suggested_issue_title: null
branch: "feat/637-hu105-acceso-codigo-cliente"
pr: 643
pr_url: "https://github.com/bcaceres19/barberia/pull/643"
depends_on:
  - "HU-104 integrada (PROMPT-HU-104-v1)"
  - "DEC-178"
rules:
  - "RN-RES-03"
  - "RN-DAT-01"
  - "RN-DAT-02"
  - "RN-DAT-03"
  - "RN-IDE-01"
  - "RN-TEN-01"
decisions:
  - "DEC-045"
  - "DEC-046"
  - "DEC-062"
  - "DEC-066"
  - "DEC-089"
  - "DEC-123"
  - "DEC-178"
acceptance_criteria:
  - "CA-105-01"
  - "CA-105-02"
  - "CA-105-03"
  - "CA-105-04"
  - "CA-105-05"
  - "CA-105-06"
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

# HU-105 · Acceso al turno con un código de un solo uso por correo o WhatsApp

## Instrucción para el agente

Implementa únicamente `HU-105` según `DEC-178`, sobre `HU-104` ya integrada. No cambies las reglas de reprogramación.

## Objetivo

En `/reservar/<slug>/mi-turno` la persona escribe su correo o su celular y recibe un código de 6 dígitos (correo o WhatsApp). Al digitarlo ve sus turnos futuros `confirmed` en esa barbería y entra a la pantalla de reprogramar de `HU-104`.

## Preflight obligatorio

1. Comprueba que `HU-104` está integrada en `main`. Si no lo está, el prompt sigue `blocked`.
2. Cambia el estado a `in_progress` y crea la rama `feat/637-hu105-acceso-codigo-cliente`.
3. Lee `DEC-178`, `HU-105`, `HU-007` (reto de acceso del personal) y los adaptadores de `notification` (correo con Resend y OTP por WhatsApp).

## Alcance incluido

- **Migración Atlas:** tabla tenant-aware `customer_access_challenge`. Columnas:
  - `barbershop_id`, `customer_id`, `channel` (`email` o `whatsapp`) y `code_hash` (HMAC);
  - `attempts`, `expires_at`, `consumed_at` y `created_at`.

  Lleva RLS, sin `DELETE`, y la registras en `tools/ci/checks/go.sh`. Para el límite por IP, reutiliza el patrón de `login_throttle` o crea una tabla equivalente sin datos personales.
- **Pedir el código:** `POST /public/barbershops/{slug}/customer-access/challenge` con `{ contact }`.
  - Normaliza el correo o el teléfono E.164 (`+57`, `DEC-141`).
  - Siempre responde `202` con el mismo cuerpo y en un tiempo comparable.
  - Solo envía si existe un cliente con ese contacto y algún turno futuro `confirmed`.
  - Límite: 3 solicitudes por contacto cada 15 minutos y un límite por IP. Al excederlo, `429` con `Retry-After`.
- **Verificar el código:** `POST /public/barbershops/{slug}/customer-access/verify` con `{ contact, code }`.
  - El código vale 10 minutos, admite 5 intentos y es de un solo uso.
  - Si es válido, emite un `appointment_access_token` de 60 minutos por cada turno futuro `confirmed` y devuelve `[{ accessToken, startsAt, serviceName, barberName }]`.
  - Si no es válido, devuelve un error uniforme.
- **Envío:** el correo usa la plantilla de marca (`DEC-143`) con el slot `Code`; WhatsApp usa la plantilla de autenticación ya configurada (`APP_META_WHATSAPP_TEMPLATE_NAME`). El contacto y el código nunca aparecen en logs.
- **Interfaz:** página dedicada con los pasos contacto, código y turno.
  - El código va en 6 casillas que admiten pegar el código entero; el reenvío tiene cuenta atrás.
  - Con un solo turno entra directo a `/mi-turno/<token>/reprogramar`; con varios muestra una lista.
  - En la entrada pública, el enlace «¿Ya tienes un turno? Cámbialo aquí».

## Fuera de alcance

- SMS, cuenta o portal con contraseña, nuevas reglas de cancelación y cambios a `HU-104`.

## Pruebas y evidencia

- Dominio: código, vencimiento, intentos, un solo uso y límites.
- PostgreSQL real con dos tenants: aislamiento, RLS y emisión de tokens.
- HTTP público: respuesta uniforme y `429`.
- Adaptadores con un servidor HTTP de prueba.
- Vitest de los pasos.
- Playwright con el API simulado y evidencia a 320/360/768/1280 px con axe-core.

## Documentación y trazabilidad

- OpenAPI, `database/README.md`, diccionario de datos, `matriz-trazabilidad.md`, `historial-cambios.md`, `historias-usuario.md` y este catálogo.

## Verificación final

```text
cd apps/api && go vet ./... && go test ./...   (con PostgreSQL efímera y migraciones de go.sh)
cd apps/web && npm run lint && npm run typecheck && npm run test -- --run
```

## Git y PR

- Commit/PR: `feat(customer-access): acceso al turno con código de un solo uso (HU-105)`.
- `Closes #637`.
