@AGENTS.md

# Claude Code

`AGENTS.md` es la autoridad compartida con Codex y se importa arriba. Este archivo solo añade lo específico de Claude Code; no repitas aquí reglas que ya viven allí (prompts persistentes, fidelidad visual, Git).

## Skills del proyecto

- `.claude/skills/<skill>/SKILL.md` son adaptadores: al activarse, lee y sigue el skill canónico `.agents/skills/<skill>/SKILL.md`.
- `nava-mockup-fidelity` y `browser-viewport-verification` son alias heredados de `visual-qa`; si un prompt los cita, aplica `visual-qa` (modo fidelidad y verificación de viewport efectivo).

## Graphify

- Es opcional. Úsalo solo si el usuario lo pide (`/graphify`) o si un descubrimiento transversal no se resuelve con búsqueda textual y el ownership del módulo. No lo consultes ni ejecutes `graphify update` en trabajo rutinario. Antes de consultarlo, aplica el skill `graphify-refresh`, que decide si hace falta actualizarlo.

## Documentación

- La documentación y las decisiones están en `/home/bcaceres/Proyectos/proyecto-nava/nava-docs/agenda` (ver «Documentación» en `AGENTS.md`). Antes de implementar, se leen allí; lo nuevo se escribe allí, con un PR a `nava-project/nava-docs`. Nunca se agregan documentos a este repo.
- Autorización del propietario (2026-11-18): los PR propios a nava-docs que solo tocan `agenda/` se mergean sin esperar revisión.

## Merge de pull requests

- Autorización permanente del propietario (2026-08-13): en cuanto todos los checks de CI de un PR contra `main` estén en verde, haz squash-merge sin pedir confirmación adicional por ese paso. No hace falta preguntar cada vez.
- Si algún check falla o queda pendiente, no mergees: investiga o espera.
- Autorización del propietario (2026-11-18, «tu puedes mergear y mandar a desplegar tus temas»): después del merge, se sigue el deploy de Jenkins (`agenda/deploy`), se relanza con el mismo SHA si falla por causas ajenas al código y se verifica en agenda.nava.wtf (salud, migraciones y HTTPS público). Si falla por el código, se corrige con otro PR o se revierte.
- Esta autorización cubre el merge en sí. Sigue pidiendo confirmación aparte para otras acciones destructivas o que afecten estado compartido (force-push, borrar ramas, reescribir `main`, etc.), salvo que el usuario las autorice explícitamente también.
