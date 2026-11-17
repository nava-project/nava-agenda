---
prompt_id: "PROMPT-OPS-MIGRAR-PROYECTO-A-JENKINS-VPS-v1"
version: "1.0"
kind: "ops"
status: "draft"
target_agents:
  - "any"
repository: "externo — el repositorio del proyecto a migrar (p. ej. bcaceres19/odin o bcaceres19/odin-pedidos); el registro de jobs se hace aparte en bcaceres19/barberia"
base_branch: "main"
primary_hu: null
related_hu: []
issue: "pending"
issue_url: null
suggested_issue_title: "ci: migrar el CI/CD de GitHub Actions al Jenkins compartido de la VPS"
branch: null
pr: null
pr_url: null
depends_on:
  - "DEC-177 (Jenkins en la VPS operativo; integrado en bcaceres19/barberia #618, #621, #622)"
rules: []
decisions:
  - "DEC-160"
  - "DEC-177"
acceptance_criteria: []
source_docs:
  - "AGENTS.md (del repositorio destino, si existe)"
  - "bcaceres19/barberia: deploy/jenkins/README.md"
  - "bcaceres19/barberia: deploy/jenkins/casc/jobs.groovy"
  - "bcaceres19/barberia: deploy/jenkins/casc/jenkins.yaml"
  - "bcaceres19/barberia: Jenkinsfile, tools/ci/run.sh, tools/ci/checks/*.sh"
  - "bcaceres19/barberia: deploy/jenkins/pipelines/deploy.Jenkinsfile, deploy/jenkins/scripts/release.sh"
created_at: "2026-11-16"
updated_at: "2026-11-16"
supersedes: null
superseded_by: null
---

# Migrar el CI/CD de un proyecto al Jenkins compartido de la VPS

## Instrucción para el agente

Migra **un** repositorio (el que se indique al ejecutar este prompt; en adelante `<REPO>`, p. ej. `bcaceres19/odin-pedidos`) de GitHub Actions al Jenkins que ya corre en la VPS. Trabaja de forma autónoma hasta que un commit nuevo en `main` de `<REPO>` pase el CI en Jenkins y quede desplegado solo en la VPS. No amplíes el alcance, no toques la aplicación de otros proyectos y no inventes decisiones: si algo no encaja, detente y regístralo.

Ejecuta este prompt una vez por repositorio. Cada ejecución tiene su propio issue en `<REPO>`.

## Objetivo

Al terminar:

1. Cada PR contra `main` y cada commit de `main` de `<REPO>` ejecutan en Jenkins los **mismos** checks que hoy ejecuta GitHub Actions, y Jenkins publica el estado en el commit (`continuous-integration/jenkins/branch` y `continuous-integration/jenkins/pr-merge`).
2. Cuando el CI de `main` termina en verde, Jenkins despliega ese SHA en la VPS con el `deploy.sh` del proyecto, conservando sus controles (respaldo, salud, rollback).
3. Una persona puede redesplegar o volver a un SHA anterior de `main` desde Jenkins.
4. Los workflows de `.github/workflows/` del proyecto quedan eliminados y su contenido equivalente vive en Jenkins.

## Lo que ya existe (no lo reconstruyas)

- **Jenkins**: `https://jenkins.nava.wtf`, contenedor `jenkins-controller-1` en la VPS (alias SSH `barberia-vps`, Fedora, SELinux enforcing, Docker). Se configura **como código** desde `bcaceres19/barberia`, carpeta `deploy/jenkins/`: imagen del controlador, plugins, JCasC (`casc/jenkins.yaml`) y jobs (`casc/jobs.groovy`, Job DSL, una carpeta por proyecto). Nada se configura a mano en la interfaz: se perdería al reconstruir.
- **Credenciales ya cargadas en Jenkins** (ids):
  - `github-token`: usuario y contraseña (`bcaceres19` y un token con acceso a todos los repos del usuario). Sirve para el checkout, la API y los estados de commit de cualquier repo de `bcaceres19`.
  - `github-token-text`: el mismo token como texto.
  - `github-webhook-secret`: secreto HMAC global de los webhooks. Sirve para cualquier repo.
  - `vps-deploy-ssh`: llave privada del usuario `deploy` del host, aceptada solo desde la red de Jenkins (`restrict,from="10.89.10.0/24"`: permite comandos, no terminal ni reenvíos).
  - `maps-browser-key`: exclusiva de barbería; no la uses.
- **Red**: el controlador está en la red `ci` 10.89.10.0/24 (Jenkins en .2). El host es `10.89.10.1` y su huella SSH está en `/run/secrets/DEPLOY_KNOWN_HOSTS` dentro del contenedor. Además está en la red externa `edge` (alias `jenkins`), donde el Caddy de barbería (dentro de `nava-web-1`) lo publica.
- **Docker**: el controlador usa el socket del host (grupo docker, GID 990). Por tanto, `docker run` dentro de un pipeline crea contenedores **hermanos** en el host. `JENKINS_HOME` es `/srv/jenkins/home` tanto en el host como en el contenedor, así que `-v "$PWD:$PWD"` desde un workspace funciona.
- **Mantenimiento**: el job `vps/mantenimiento` (diario) borra los contenedores con etiqueta `nava-ci=1` de más de 3 h y la caché de construcción de más de 7 días. Es común a todos los proyectos.
- **Ejecutores**: 3, compartidos por todos los proyectos.

## Preflight obligatorio

1. En `<REPO>`, árbol limpio y `main` actualizado por fast-forward. Lee su `AGENTS.md`/`CLAUDE.md` si existen y respeta su flujo (issue, rama corta, Conventional Commits, squash).
2. Lee completo, en `bcaceres19/barberia` (rama `main`): `deploy/jenkins/README.md`, `deploy/jenkins/casc/jobs.groovy`, `deploy/jenkins/casc/jenkins.yaml`, `Jenkinsfile`, `tools/ci/run.sh`, `tools/ci/checks/*.sh`, `deploy/jenkins/pipelines/deploy.Jenkinsfile` y `deploy/jenkins/scripts/release.sh`. Son la implementación de referencia: cópiala y adáptala, no la reinventes.
3. Lee **todos** los workflows de `<REPO>` y su `deploy/deploy.sh` y `deploy/compose.yaml`. Haz una tabla `job/step de Actions → equivalente en Jenkins`. Ningún check puede desaparecer.
4. Lista los secretos y variables de GitHub del repo y de sus entornos (`gh secret list`, `gh secret list -e <entorno>`, `gh variable list`). Para cada uno, decide: ya existe en Jenkins, debe crearse, o deja de hacer falta. Por ejemplo, `VPS_*` deja de hacer falta porque se usa `vps-deploy-ssh`, y `GITHUB_TOKEN` del job se sustituye por `github-token`.
5. Comprueba que Jenkins está sano: `curl -fsS -o /dev/null -w '%{http_code}' https://jenkins.nava.wtf/login` debe dar 200.
6. Crea el issue en `<REPO>` con el título sugerido y criterios verificables, y la rama `ci/<issue>-jenkins`.

## Alcance incluido

**A. En `<REPO>`** (un PR):

1. `Jenkinsfile` en la raíz (CI declarativo):
   - `options { timeout(time: 60, unit: 'MINUTES'); disableConcurrentBuilds(abortPrevious: true); buildDiscarder(logRotator(numToKeepStr: '30')) }`.
   - Etapas equivalentes a los jobs de Actions. Lo independiente va en `parallel`, siempre que la memoria lo permita (ver _Recursos_).
   - Cada check corre **en un contenedor**, nunca con herramientas instaladas en el controlador. Usa imágenes oficiales con versión fija (p. ej. `node:22-bookworm`, `ghcr.io/astral-sh/uv:<versión>-python3.x-bookworm`) o una imagen de herramientas propia en `tools/ci/ci.Dockerfile`, etiquetada con el hash de su contenido como hace barbería.
   - `post { success { script { if (env.BRANCH_NAME == 'main') build job: '/<carpeta>/deploy', wait: false, parameters: [string(name: 'SHA', value: env.GIT_COMMIT), booleanParam(name: 'AUTO', value: true)] } } }`.
2. Un lanzador `tools/ci/run.sh <check> [--postgres]`, adaptado del de barbería:
   - `docker run --rm --init --user 1000:1000 --security-opt label=disable --cpu-shares 512 --memory <límite> -v "$root:$root" -w "$root" -v <proyecto>-ci-cache:/cache --label nava-ci=1 --name "<proyecto>-ci-${BUILD_TAG}-<check>" ...`.
   - Con `--postgres`: una base efímera `docker run -d --tmpfs /var/lib/postgresql/data --label nava-ci=1 --memory 768m ... <misma imagen y versión que producción>`. Espera con `docker exec <pg> pg_isready -h 127.0.0.1` y corre el check con `--network container:<pg>`, de modo que la base esté en `127.0.0.1:5432` como en Actions.
   - `trap` que borre los contenedores al salir, incluso si falla.
3. `deploy/jenkins/deploy.Jenkinsfile`, con parámetros `SHA` (vacío = tip de `main`) y `AUTO`:
   - `disableConcurrentBuilds()` sin `abortPrevious`: un despliegue nunca se corta a medias. `timeout` de 45 min.
   - `environment { GITHUB_REPO = '<REPO>'; PUBLIC_URL = 'https://<dominio>' }` en el propio pipeline. Los globales de Jenkins (`GITHUB_REPO`, `PUBLIC_URL`) son los de barbería: **no** los uses ni los cambies.
   - Etapas `Verificar commit` → `Imagen` → `Desplegar` → `Comprobar HTTPS`, con un script `deploy/jenkins/release.sh <fase>` adaptado del de barbería. Las etapas después de `Verificar` se saltan si existe `.release/skip`.
4. `deploy/deploy.sh`: añade la opción `--no-pull` para usar la imagen ya presente en el Docker del host, sin `docker login` ni `pull`. Conserva intacto el modo actual, que sirve para volver atrás si hace falta, y también los respaldos, la salud y el rollback.
5. Elimina `.github/workflows/*.yml` que queden sustituidos. Actualiza el README o la documentación de despliegue del proyecto: dónde está el CI/CD ahora, cómo redesplegar o volver atrás, y cómo apagar el despliegue automático (desactivar el job `<carpeta>/deploy`).

**B. En `bcaceres19/barberia`** (PR aparte, con su propio issue en barberia; título sugerido `ci(jenkins): registrar los jobs de <proyecto>`):

1. En `deploy/jenkins/casc/jobs.groovy`, añade `folder('<carpeta>')`, `multibranchPipelineJob('<carpeta>/ci')` y `pipelineJob('<carpeta>/deploy')` copiando los de `barberia/`, con `repository('<repo>')`, un `id` de fuente único y `scriptPath` del deploy en `deploy/jenkins/deploy.Jenkinsfile`. Mantén `headWildcardFilter('main PR-*')`, `periodicFolderTrigger('5m')` y las estrategias 1/1.
2. Si el proyecto necesita un secreto nuevo en el pipeline (casi nunca: los secretos de ejecución viven en `/srv/<proyecto>/env` del host), añádelo como archivo en `/srv/jenkins/secrets` con `jenkins-secret-set.sh`, declara la credencial en `casc/jenkins.yaml` y documéntalo en la tabla de secretos de `deploy/jenkins/README.md`.
3. Actualiza `deploy/jenkins/README.md` (sección de pipelines) y añade una nota a DEC-177 en `docs/00-control/registro-decisiones.md` con su fila en `historial-cambios.md`, según el `AGENTS.md` de barbería.
4. Aplica el cambio en la VPS siguiendo el README: copia `deploy/jenkins` a `/srv/jenkins/stack` y ejecuta `sudo bash jenkins-up.sh`. Verifica que los jobs nuevos aparecen.

**Orden:** integra B primero; si no, los jobs no existen. El escaneo inicial de `<carpeta>/ci` no encontrará `Jenkinsfile` en `main` hasta que se integre A, y eso es esperado: el PR de A sí se construye, porque `PR-*` usa el `Jenkinsfile` del PR.

**C. Webhook** en `<REPO>`: `https://jenkins.nava.wtf/github-webhook/`, `content_type=json`, eventos `push` y `pull_request`, con el mismo secreto que `/srv/jenkins/secrets/GITHUB_WEBHOOK_SECRET`. Léelo en el servidor y pásalo a `gh api` por stdin, nunca en la línea de comandos ni en un log. El comando exacto está en `deploy/jenkins/README.md`.

## Fuera de alcance

- Cambiar la aplicación, sus pruebas o sus umbrales. Si una prueba falla en Jenkins, primero averigua por qué (ver _Trampas_). No la borres, no la marques como skip y no bajes la cobertura.
- Tocar los contenedores, redes o datos de otros proyectos, o el Caddy de barbería, salvo un `reverse_proxy` nuevo si el proyecto lo necesita, y eso en el PR B.
- Montar un registro de imágenes o un agente de Jenkins separado.
- Borrar paquetes de GHCR, entornos o secretos de GitHub: **pide confirmación** al propietario antes.

## Trampas ya resueltas en barbería (léelas antes de depurar)

1. **SELinux**: sin `--security-opt label=disable`, el contenedor no puede leer el workspace montado (`Permission denied`). No uses `:z`/`:Z`: re-etiquetarían el `JENKINS_HOME` compartido.
2. **UID**: corre los checks como `--user 1000:1000`, el UID de Jenkins, o dejarán en el workspace archivos de root que el siguiente build no puede borrar. Las cachés van en un volumen con nombre montado en `/cache`, propiedad de 1000, con `HOME=/cache/home`.
3. **Credenciales de git en `sh`**: los pasos `sh` **no** heredan las credenciales del checkout. Un `git fetch` a un repo privado falla con `could not read Username`. Usa `withCredentials([usernamePassword(credentialsId: 'github-token', usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')])` y un helper que lea el entorno, como en `release.sh verify`: `git -c credential.helper= -c 'credential.helper=!f() { echo "username=$GH_USER"; echo "password=$GH_TOKEN"; }; f' fetch ...`.
4. **CPU lenta**: las vCPU de la VPS son unas 2 veces más lentas que los runners de GitHub, y el CI comparte la máquina con producción. Usa `--cpu-shares 512`, nunca `--cpus`: con cuota, los tests rozaban el timeout. Limita los workers (p. ej. `--maxWorkers=2` en vitest/jest, `-n 2` en pytest-xdist). Si un test agota un timeout por lentitud **demostrada** (mide el tiempo en Jenkins frente a Actions), sube el timeout del runner solo en el CI y documéntalo en un comentario. No es licencia para ignorar fallos reales.
5. **Base de un PR desactualizada**: con la estrategia de merge, Jenkins fusiona el PR con el `base.sha` que GitHub guardó al abrirlo, no con el `main` actual. Si `main` avanzó y el resultado no cuadra, ejecuta `gh pr update-branch <n>` y reescanea.
6. **Un push nuevo aborta el build en curso** del mismo PR o rama (`abortPrevious`). Espera a que termine si necesitas su resultado.
7. **Despliegue de un commit viejo**: con `AUTO=true`, si el SHA ya no es la punta de `main`, el despliegue se omite (`.release/skip`), porque el CI del commit nuevo desplegará el suyo. A mano (`AUTO=false`), `verify` exige que el estado `continuous-integration/jenkins/branch` del SHA sea `success` en la API de GitHub.
8. **Sin checks obligatorios**: el plan gratuito no permite exigir checks en un repo privado. Integra un PR solo con `continuous-integration/jenkins/pr-merge` en `success`.
9. **Sin registro**: Jenkins construye con `docker build` en el Docker del host y etiqueta como hoy (`ghcr.io/bcaceres19/<imagen>:<sha>`), para que `compose.yaml` no cambie. Si la etiqueta ya existe, no reconstruyas. Una imagen con estado (una base) **nunca** se reconstruye con la misma etiqueta: compose recrearía el contenedor.
10. **SSH al host**: `ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/secrets/DEPLOY_KNOWN_HOSTS deploy@10.89.10.1 ...`. Envía los archivos con `tar ... | ssh ... "tar x -C /srv/<proyecto>/releases/<sha>"`, porque `restrict` no impide `scp`, pero `tar` mantiene una sola conexión y permisos. `/srv/<proyecto>` debe ser escribible por `deploy`, como hoy.
11. **API de Jenkins sin interfaz** (diagnóstico): `ssh barberia-vps "sudo docker exec jenkins-controller-1 curl -gfsS -u admin:\$(cat /run/secrets/ADMIN_PASSWORD) http://127.0.0.1:8080/job/<carpeta>/job/ci/job/PR-<n>/lastBuild/consoleText"`. Los POST necesitan crumb y cookie jar. La contraseña nunca va a un log ni al chat.
12. **shellcheck**: un comentario que empieza por `# shellcheck` se interpreta como directiva (SC1073). Redáctalo de otra forma.

## Particularidades conocidas (a 2026-11-16; verifícalas)

- **`bcaceres19/odin-pedidos`**:
  - Hoy tiene `tests` (npm con PostgreSQL 16 de servicio, más shellcheck, `compose config` e imagen) y `deploy` (`workflow_run` + `workflow_dispatch` con SHA, entorno `production`, URL `https://pedidos.nava.wtf`).
  - Su `deploy.sh` hace `docker pull` con `DOCKER_CONFIG=/srv/pedidos/.docker` y comprueba la salud desde la red `edge` (`pedidos:8080/healthz`).
  - Secretos: `VPS_HOST`, `VPS_KNOWN_HOSTS`, `VPS_SSH_KEY` (entorno `production`).
- **`bcaceres19/odin`**:
  - Un solo `ci-cd.yml`: `test` (uv con ruff, mypy y pytest con lista de `--ignore`), `integration` (pgvector `0.8.7-pg17-bookworm` con el rol runtime `odin_app` sin BYPASSRLS), `image` (GHCR `:sha` y `:latest`) y `deploy` (scp de `compose.yaml` y `deploy.sh`, `ln -sfn current`, `docker login` con `DOCKER_CONFIG=/srv/odin/.docker`).
  - Se publica por un túnel `cloudflared`, no por el Caddy: averigua la URL pública para `PUBLIC_URL` o deja la comprobación pública documentada como omitida.
  - Secretos: `VPS_HOST`, `VPS_KNOWN_HOSTS`, `VPS_SSH_KEY`, `VPS_USER`.
- Ambos usan `/srv/<proyecto>/{releases,current,env,backups,current-tag,previous-tag}` en el host. Conserva esa estructura.

## Pruebas y evidencia

- El PR A muestra los dos estados de Jenkins en verde en GitHub. Pega el enlace al build.
- Tabla `check de Actions → etapa de Jenkins → resultado`, sin huecos.
- Prueba negativa: en una rama desechable, rompe a propósito un test y comprueba que Jenkins publica `failure`. No la integres; bórrala después **con confirmación**.
- Tras integrar A: el build de `main` dispara `<carpeta>/deploy` con `AUTO=true` y termina en `SUCCESS`. `curl` a la URL pública devuelve el código esperado, y `docker ps` en el host muestra la imagen `:<sha nuevo>`.
- Un redespliegue manual del mismo SHA desde Jenkins (`AUTO=false`) también termina en `SUCCESS`, sin reconstruir la imagen.
- El webhook de `<REPO>` muestra entregas `ping` y `push` con 200 (`gh api repos/<REPO>/hooks/<id>/deliveries`).
- `shellcheck -x -S warning` limpio en los scripts nuevos.

## Verificación final

Entrega una tabla:

`Criterio | Estado | Prueba o evidencia`

No declares cumplido nada que no hayas visto pasar. Si un despliegue falla, la aplicación en ejecución debe seguir intacta: `deploy.sh` ya protege eso. Repórtalo con el log.

## Git y PR

- Commits y PR en Conventional Commits: `ci: migrar el CI/CD de GitHub Actions a Jenkins en la VPS` en `<REPO>`, y `ci(jenkins): registrar los jobs de <proyecto>` en barberia.
- Usa `Closes #<issue>` en cada PR de su propio repositorio. No hagas push directo, force push ni reescribas `main`. Integra por squash cuando todos los checks estén en verde.
- Después de integrar, pregunta al propietario si quiere borrar el entorno y los secretos de GitHub que quedaron sin uso, y los paquetes de GHCR antiguos.
