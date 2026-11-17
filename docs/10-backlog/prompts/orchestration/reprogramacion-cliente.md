---
prompt_id: "PROMPT-ORCH-REPROGRAMACION-CLIENTE-v1"
version: "1.0"
kind: "orchestration"
status: "in_progress"
target_agents:
  - "any"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: null
related_hu:
  - "HU-104"
  - "HU-105"
issue: 636
issue_url: "https://github.com/bcaceres19/barberia/issues/636"
suggested_issue_title: null
branch: null
pr: null
pr_url: null
depends_on:
  - "DEC-178"
rules:
  - "RN-CAN-01"
  - "RN-RES-03"
decisions:
  - "DEC-178"
acceptance_criteria: []
source_docs:
  - "AGENTS.md"
  - "docs/00-control/registro-decisiones.md"
  - "docs/02-requisitos/historias-usuario.md"
created_at: "2026-11-17"
updated_at: "2026-11-17"
supersedes: null
superseded_by: null
---

# Orquestación · Reprogramación por el cliente (`DEC-178`)

## Orden

1. [PROMPT-HU-104-v1](../hu/hu-104-reprogramacion-cliente.md), issue [#636](https://github.com/bcaceres19/barberia/issues/636): operación y pantalla de reprogramar desde el enlace del turno.
2. [PROMPT-HU-105-v1](../hu/hu-105-acceso-codigo-cliente.md), issue [#637](https://github.com/bcaceres19/barberia/issues/637): acceso con código de un solo uso por correo o WhatsApp, que lleva a la pantalla de `HU-104`.

## Criterio de avance

- `HU-105` empieza solo con el PR de `HU-104` integrado en `main` y su CI en verde.
- Cada historia conserva su rama, sus pruebas y su PR. No se mezclan commits.
- Si `HU-104` cambia la forma del token o de la pantalla, el prompt de `HU-105` se versiona antes de ejecutarlo.
