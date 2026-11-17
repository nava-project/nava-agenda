---
prompt_id: "PROMPT-ORCH-MIGRAR-ODIN-Y-PEDIDOS-A-JENKINS-v1"
version: "1.0"
kind: "orchestration"
status: "in_progress"
target_agents:
  - "claude"
  - "codex"
repository: "externo — bcaceres19/odin-pedidos y bcaceres19/odin (registro de jobs en bcaceres19/barberia)"
base_branch: "main"
primary_hu: null
related_hu: []
issue: "bcaceres19/odin-pedidos#2, bcaceres19/barberia#630 (pedidos); bcaceres19/odin#1, bcaceres19/barberia#632 (odin)"
issue_url: "https://github.com/bcaceres19/barberia/issues/630"
suggested_issue_title: "ci: migrar el CI/CD de GitHub Actions al Jenkins compartido de la VPS (uno por repositorio)"
branch: null
pr: null
pr_url: null
depends_on:
  - "PROMPT-OPS-MIGRAR-PROYECTO-A-JENKINS-VPS-v2"
  - "DEC-177"
rules: []
decisions:
  - "DEC-160"
  - "DEC-177"
acceptance_criteria: []
source_docs:
  - "bcaceres19/barberia: docs/10-backlog/prompts/ops/issue-pending-migrar-proyecto-a-jenkins-vps-v2.md"
  - "bcaceres19/barberia: deploy/jenkins/README.md"
created_at: "2026-11-16"
updated_at: "2026-11-16"
supersedes: null
superseded_by: null
---

# Migrar Odin y Odin-pedidos al Jenkins de la VPS

## Instrucción para el agente

Coordina dos migraciones **independientes y en serie**, cada una con sus propios issues, ramas y PR. No combines las ramas ni los PR de los dos repositorios.

Cada migración se hace ejecutando completo el prompt [`PROMPT-OPS-MIGRAR-PROYECTO-A-JENKINS-VPS-v2`](../ops/issue-pending-migrar-proyecto-a-jenkins-vps-v2.md). Léelo entero antes de empezar. Aquí solo se fijan el orden, las compuertas y lo que se entrega al final. El cuerpo técnico, las trampas y las particularidades de cada repo están en ese prompt; si este archivo y aquel discrepan, manda aquel.

Para leerlo:

- en local: `/home/bcaceres/Proyectos/barberia/docs/10-backlog/prompts/ops/issue-pending-migrar-proyecto-a-jenkins-vps-v2.md`;
- o en GitHub: `gh api repos/bcaceres19/barberia/contents/docs/10-backlog/prompts/ops/issue-pending-migrar-proyecto-a-jenkins-vps-v2.md --jq .content | base64 -d`.

**Autorización del propietario (2026-11-16):** migrar `bcaceres19/odin-pedidos` y `bcaceres19/odin` a Jenkins, incluidos los PR de registro de jobs en `bcaceres19/barberia` y la actualización de Jenkins en la VPS que el prompt v2 describe. Borrar secretos, entornos o paquetes de GitHub sigue necesitando confirmación aparte.

## Orden y compuertas

| Paso | Qué                                                                                                                                              | Compuerta para seguir                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Preflight común: Jenkins sano (`/login` 200), `bcaceres19/barberia` con `main` al día y su CI en verde, y acceso a `ssh barberia-vps` con `sudo` | todo comprobado                                                                                                                                                                      |
| 1    | **`odin-pedidos`** (`<proyecto>` = `pedidos`): prompt v2 completo, partes A, B y C                                                               | su despliegue automático en `SUCCESS`, `https://pedidos.nava.wtf/healthz` 200 y un merge con salto de checks por árbol ya verificado                                                 |
| 2    | **`odin`** (`<proyecto>` = `odin`): prompt v2 completo, partes A, B y C                                                                          | su despliegue automático en `SUCCESS`, el contenedor `app` de la pila `odin` `healthy` con la imagen del SHA nuevo, y como mucho dos imágenes de Odin en el host (actual y anterior) |
| 3    | Cierre: informe conjunto y preguntas pendientes al propietario                                                                                   | entregado                                                                                                                                                                            |

**Por qué este orden:**

- **Pedidos va primero** porque es más pequeño: imagen de 240 MB, su `deploy.sh` ya usa la imagen local y tiene URL pública para comprobar la salud. Valida el patrón con menos riesgo.
- **Odin va después:** necesita cambiar su `deploy.sh`, su imagen pesa 1,7 GB y no tiene URL pública.
- **En serie, no en paralelo:**
  - los dos PR de registro tocan el mismo `deploy/jenkins/casc/jobs.groovy` de barbería y chocarían;
  - las dos migraciones compartirían una VPS de 4 vCPU con la producción y el CI de barbería.

Si un paso no supera su compuerta, **detente**. Deja el estado y el bloqueo en el issue de ese repositorio y no empieces el siguiente. La aplicación en producción debe seguir sirviendo: si algo falla, `deploy.sh` vuelve a la versión anterior.

## Reglas para el agente coordinador

- Cada repositorio tiene su issue y su PR. Cada registro en barbería tiene su issue y su PR (dos en total, uno por proyecto, integrados en orden).
- Antes del paso 2, vuelve a actualizar `main` de barbería: el registro de pedidos ya estará integrado y el de Odin se añade encima.
- No toques la aplicación ni las pruebas de ningún proyecto, ni amplíes listas de `--ignore`. Si una prueba falla en Jenkins, investígala como dice el prompt v2.
- No uses ni cambies el Jenkins de forma manual en la interfaz. Todo va como código y por PR.
- Nunca imprimas la contraseña de `admin`, el token ni el secreto del webhook en logs, PR o chat.

## Entrega final (paso 3)

Un informe con:

1. Por cada repositorio:
   - issue y PR de `<REPO>` y de barbería, con enlaces;
   - tabla `Criterio | Estado | Prueba o evidencia` del prompt v2;
   - tiempos del CI completo en Jenkins frente a GitHub Actions;
   - tiempo del merge a producción con salto de checks.
2. Estado de la VPS después: `df -h /`, `docker system df` y número de imágenes por proyecto.
3. Preguntas pendientes al propietario, sin ejecutarlas:
   - borrar los secretos `VPS_*` y el entorno `production` de cada repo;
   - borrar los paquetes antiguos de GHCR;
   - quitar de `~deploy/.ssh/authorized_keys` las llaves que usaban esos workflows.
