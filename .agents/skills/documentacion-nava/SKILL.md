---
name: documentacion-nava
description: "Úsala SIEMPRE al empezar una tarea (para leer lo que ya está documentado sobre ella) y cada vez que vayas a escribir, actualizar o mover documentación de cualquier tipo — decisiones (DEC-*), ADR, planes, specs, guías, runbooks, notas de diseño, informes, changelogs. Toda la documentación de Nava vive en la bóveda de Obsidian nava-docs; este repo NO lleva documentación."
---

# Documentación de Nava: la bóveda nava-docs

- Bóveda: `/home/bcaceres/Proyectos/proyecto-nava/nava-docs` (repo `nava-project/nava-docs`,
  abierta en Obsidian). Es la "mente" compartida de todos los proyectos de Nava.
- Carpeta de este proyecto: `agenda/`. Lo transversal (org, CI/CD, convenciones,
  sesiones): `ecosistema/`. Las demás carpetas son de otros productos: léelas, no las edites.

## 1. Antes de trabajar: lee la bóveda

1. Actualízala: `git -C /home/bcaceres/Proyectos/proyecto-nava/nava-docs pull -q`.
2. Lee `README.md` de la bóveda, `agenda/README.md` y lo que enlacen sobre el tema de la tarea.
3. Busca todo lo relacionado:
   `grep -rli "<tema>" /home/bcaceres/Proyectos/proyecto-nava/nava-docs --include=*.md`
   (incluye `ecosistema/` y, si la tarea cruza productos, las carpetas de los otros).
4. La bóveda manda sobre decisiones y diseño. Si el código la contradice, no la ignores:
   dilo y corrige lo que esté mal (código o bóveda).

## 2. Al documentar: solo en la bóveda, nunca en este repo

En este repo está PROHIBIDO crear o ampliar documentación: nada de `docs/`, ADR, planes,
specs, notas, informes, `CHANGELOG`, `CONTRIBUTING` ni archivos `.md` explicativos.
Solo se permiten:
- `README.md` mínimo (qué es, cómo arrancar, enlace a `nava-docs/agenda`);
- instrucciones para agentes: `CLAUDE.md`, `AGENTS.md`, `.claude/skills/*`;
- archivos que el código o el CI consumen. En este repo: `api/openapi/**` (contrato
  contract-first, incluidos su `README.md` y su `CHANGELOG.md`), el SQL de `database/`,
  `.github/PULL_REQUEST_TEMPLATE.md` y el artefacto generado `apps/web/graphify-out/`.
- capturas que generan las pruebas en `apps/web/e2e/evidence/`: están ignoradas por git.
  La evidencia que se conserva se copia a `agenda/` de la bóveda.

Si encuentras documentación en este repo, muévela a la bóveda y bórrala de aquí en un PR.

### Flujo

1. Worktree de la bóveda en tu scratchpad (no edites el checkout compartido):
   `git -C /home/bcaceres/Proyectos/proyecto-nava/nava-docs fetch -q && git -C /home/bcaceres/Proyectos/proyecto-nava/nava-docs worktree add <scratchpad>/nava-docs-wt -b docs/agenda-<tema> origin/main`
2. Escribe en `agenda/`, commit y PR a `nava-project/nava-docs`.
3. Si el PR solo toca `agenda/`, mergéalo tú mismo (`gh pr merge --squash`) sin esperar a nadie.
   Cambios en `ecosistema/` o en carpetas de otros: pídelos al orquestador por SendMessage.
4. Un cambio de código que cambia comportamiento, decisiones o la forma de operar va con
   su PR de documentación; enlaza uno desde el otro.
5. Borra el worktree al terminar (`git worktree remove`).

### Formato

- Markdown; enlaces Markdown relativos, con el texto entre corchetes y la ruta relativa entre
  paréntesis (funcionan en Obsidian y en GitHub).
- Al código se enlaza por URL: `https://github.com/nava-project/<repo>/blob/main/<ruta>`.
- Imágenes y adjuntos en `agenda/adjuntos/`.
- Nada de secretos ni datos personales: nombres de variables sí, valores nunca.
