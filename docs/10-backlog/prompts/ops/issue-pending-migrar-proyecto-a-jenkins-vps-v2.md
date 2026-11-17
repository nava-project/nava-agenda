---
prompt_id: "PROMPT-OPS-MIGRAR-PROYECTO-A-JENKINS-VPS-v2"
version: "2.0"
kind: "ops"
status: "in_progress"
target_agents:
  - "any"
repository: "externo — el repositorio del proyecto a migrar (bcaceres19/odin-pedidos o bcaceres19/odin); el registro de jobs se hace aparte en bcaceres19/barberia"
base_branch: "main"
primary_hu: null
related_hu: []
issue: "bcaceres19/odin-pedidos#2, bcaceres19/barberia#630 (pedidos); bcaceres19/odin#1, bcaceres19/barberia#632 (odin)"
issue_url: "https://github.com/bcaceres19/barberia/issues/630"
suggested_issue_title: "ci: migrar el CI/CD de GitHub Actions al Jenkins compartido de la VPS"
branch: null
pr: null
pr_url: null
depends_on:
  - "DEC-177 (Jenkins en la VPS operativo; bcaceres19/barberia #618, #621, #622)"
  - "bcaceres19/barberia #627 (CI acelerado: tools/ci/plan.sh y checks en paralelo)"
rules: []
decisions:
  - "DEC-160"
  - "DEC-177"
acceptance_criteria: []
source_docs:
  - "AGENTS.md del repositorio destino (si existe)"
  - "bcaceres19/barberia: deploy/jenkins/README.md"
  - "bcaceres19/barberia: deploy/jenkins/casc/jobs.groovy y casc/jenkins.yaml"
  - "bcaceres19/barberia: Jenkinsfile, tools/ci/plan.sh, tools/ci/run.sh, tools/ci/checks/*.sh"
  - "bcaceres19/barberia: deploy/jenkins/pipelines/deploy.Jenkinsfile, deploy/jenkins/scripts/release.sh"
created_at: "2026-11-16"
updated_at: "2026-11-16"
supersedes: "PROMPT-OPS-MIGRAR-PROYECTO-A-JENKINS-VPS-v1"
superseded_by: null
---

# Migrar el CI/CD de un proyecto al Jenkins compartido de la VPS (v2)

## Instrucción para el agente

Migra **un** repositorio de GitHub Actions al Jenkins que ya corre en la VPS. En adelante `<REPO>` es `bcaceres19/odin-pedidos` o `bcaceres19/odin`; `<proyecto>` es `pedidos` u `odin` (nombre de la carpeta en `/srv` y de la carpeta de jobs en Jenkins).

Trabaja de forma autónoma hasta que un commit nuevo en `main` de `<REPO>` pase el CI en Jenkins y quede desplegado solo en la VPS. No amplíes el alcance, no toques la aplicación de otros proyectos y no inventes decisiones: si algo no encaja, detente y regístralo en el issue.

Ejecuta este prompt una vez por repositorio. Cada ejecución tiene su propio issue en `<REPO>` y en `bcaceres19/barberia`.

**Autorización.** El propietario autorizó el 2026-11-16 migrar `odin` y `odin-pedidos` a este Jenkins. Eso incluye el PR de registro de jobs en `bcaceres19/barberia` descrito en la parte B. Cubre la regla de `odin/AGENTS.md` que prohíbe alterar NAVA sin autorización explícita, pero **solo** para `deploy/jenkins/casc/jobs.groovy`, la documentación de Jenkins y el reinicio de Jenkins. Cualquier otro cambio en NAVA queda fuera.

## Objetivo

Al terminar:

1. Cada PR contra `main` y cada commit de `main` de `<REPO>` ejecutan en Jenkins **los mismos checks** que hoy ejecuta GitHub Actions. Jenkins publica el estado en el commit: `continuous-integration/jenkins/branch` y `continuous-integration/jenkins/pr-merge`.
2. Cuando el CI de `main` termina en verde, Jenkins despliega ese SHA en la VPS con el `deploy.sh` del proyecto, conservando sus controles: respaldo, salud y vuelta atrás.
3. Una persona puede redesplegar o volver a un SHA anterior de `main` desde Jenkins.
4. El CI no repite trabajo:
   - un commit de `main` cuyo árbol de git ya pasó el CI no vuelve a ejecutar checks;
   - un PR solo de documentación no ejecuta checks.
5. Los workflows de `.github/workflows/` quedan eliminados.

## Lo que ya existe (no lo reconstruyas)

- **Jenkins**
  - `https://jenkins.nava.wtf`, contenedor `jenkins-controller-1` en la VPS (alias SSH `barberia-vps`, Fedora con SELinux enforcing, Docker, 4 vCPU lentas, 7,5 GiB de RAM).
  - Se configura **como código** desde `bcaceres19/barberia`, carpeta `deploy/jenkins/`: imagen, plugins, JCasC (`casc/jenkins.yaml`) y jobs (`casc/jobs.groovy`, Job DSL, una carpeta por proyecto).
  - No configures nada a mano en la interfaz: se pierde al reconstruir.
  - Tiene 3 ejecutores, compartidos con barbería.
- **Credenciales ya cargadas** (ids):
  - `github-token`: usuario y contraseña (`bcaceres19` y un token con acceso a todos sus repos). Sirve para el checkout, la API y los estados de commit.
  - `github-token-text`: el mismo token como texto.
  - `github-webhook-secret`: secreto HMAC global de los webhooks.
  - `vps-deploy-ssh`: llave del usuario `deploy` del host, aceptada solo desde la red de Jenkins (`restrict,from="10.89.10.0/24"`: permite comandos, no terminal ni reenvíos). `/srv/odin` y `/srv/pedidos` son de `deploy:deploy` (750), y `deploy` está en el grupo `docker`.
  - `maps-browser-key`: es de barbería; no la uses.
- **Red**
  - El controlador está en la red `ci` 10.89.10.0/24. El host es `10.89.10.1`; su huella SSH está en `/run/secrets/DEPLOY_KNOWN_HOSTS` dentro del contenedor.
  - El controlador también está en la red `edge`.
- **Docker**
  - El controlador usa el socket del host: `docker run` en un pipeline crea contenedores **hermanos** en el host.
  - `JENKINS_HOME` es `/srv/jenkins/home` en el host y en el contenedor, así que el Docker del host puede montar el workspace.
- **Mantenimiento**
  - El job `vps/mantenimiento` (diario) borra los contenedores con etiqueta `nava-ci=1` de más de 3 h y la caché de BuildKit de más de 7 días. Es común a todos los proyectos.
  - **No** borra imágenes con etiqueta: cada `deploy.sh` limpia las suyas.
- **Implementación de referencia, rápida (barbería #627)**
  - `tools/ci/plan.sh` decide qué checks corren (árbol ya verificado, o rutas cambiadas).
  - `tools/ci/run.sh` lanza cada check en un contenedor.
  - El `Jenkinsfile` los ejecuta todos en paralelo con `when { expression { fileExists('.ci-plan/<check>') } }`.
  - **Copia y adapta**: no reinventes.

## Preflight obligatorio

1. En `<REPO>`, árbol limpio y `main` actualizado por fast-forward. Lee su `AGENTS.md`/`CLAUDE.md` si existen y sigue su flujo: issue, rama corta, Conventional Commits, squash. Copia local habitual: `/home/bcaceres/Proyectos/<repo>`.
2. Lee completo, en `bcaceres19/barberia` (rama `main`; copia local `/home/bcaceres/Proyectos/barberia`): los archivos de `source_docs`.
3. Lee **todos** los workflows de `<REPO>` y su `deploy/deploy.sh` y `deploy/compose.yaml`. Haz una tabla `job/step de Actions → etapa de Jenkins`. Ningún check puede desaparecer.
4. Lista secretos y variables de GitHub, del repo y de sus entornos: `gh secret list`, `gh secret list -e production`, `gh variable list`. Para cada uno decide si ya existe en Jenkins, si hay que crearlo o si deja de hacer falta. Los `VPS_*` dejan de hacer falta (se usa `vps-deploy-ssh`), y el `GITHUB_TOKEN` del job se sustituye por `github-token`.
5. Comprueba que Jenkins está sano: `curl -fsS -o /dev/null -w '%{http_code}' https://jenkins.nava.wtf/login` debe dar `200`.
6. Crea los issues: uno en `<REPO>` con el título sugerido, y otro en `bcaceres19/barberia` titulado `ci(jenkins): registrar los jobs de <proyecto>`. Ambos con criterios verificables. Crea las ramas `ci/<issue>-jenkins` en cada repo.

## Alcance incluido

### A. En `<REPO>` (un PR)

1. **`Jenkinsfile`** en la raíz (CI declarativo):
   - `options { timeout(time: 60, unit: 'MINUTES'); disableConcurrentBuilds(abortPrevious: true); buildDiscarder(logRotator(numToKeepStr: '30')) }`.
   - Etapas:
     - `Plan`: `sh 'tools/ci/plan.sh'` y `currentBuild.description` con `.ci-plan/.summary`.
     - `Preparar`: imagen de herramientas e instalación de dependencias, una sola vez.
     - `Checks`: en **paralelo**, cada uno con su `when` según el plan.
     - `Imagen`: en `main` siempre; en un PR, si el plan la pide.
   - `post { success { sh 'tools/ci/plan.sh record'; script { if (env.BRANCH_NAME == 'main') build job: '/<proyecto>/deploy', wait: false, parameters: [string(name: 'SHA', value: env.GIT_COMMIT), booleanParam(name: 'AUTO', value: true)] } } }`.
   - Una función auxiliar que use un paso (`fileExists`) va en un bucle `for`, nunca dentro de un closure de `any`/`each`: el CPS de Jenkins no lo admite.
2. **`tools/ci/plan.sh`**, adaptado del de barbería:
   - Árbol ya verificado en `$JENKINS_HOME/<proyecto>-ci-green/<árbol>` → ningún check.
   - Si no, reglas por ruta frente a la base: en un PR, el primer padre del merge; en `main`, el commit anterior, y solo si ese commit está verificado.
   - Documentación → nada. Código → sus checks. `Jenkinsfile`, `tools/ci/` o cualquier ruta sin regla → **todo**.
   - Escribe las reglas para la estructura real de `<REPO>` y pruébalas en un clon desechable con commits sintéticos: docs, código, migración, deploy, ruta sin regla, `tools/ci`, merge estilo PR y árbol repetido.
   - **Ojo:** una migración la leen las pruebas de integración, así que activa también esas pruebas.
3. **`tools/ci/run.sh <check> [--postgres]`**, adaptado del de barbería:
   - `docker run --rm --init --user 1000:1000 --security-opt label=disable --cpu-shares 512 --memory <tope> -v "$root:/workspace" -w /workspace -v <proyecto>-ci-cache:/cache --label nava-ci=1 --name "<proyecto>-ci-${BUILD_TAG}-<check>" <imagen> tools/ci/checks/<check>.sh`.
   - El workspace va **siempre en `/workspace`**, para que las cachés dependientes de la ruta sirvan entre ramas.
   - Cachés en el volumen con nombre (`HOME=/cache/home`, `UV_CACHE_DIR=/cache/uv`, `npm_config_cache=/cache/npm`…), propiedad de 1000.
   - Con `--postgres`: base efímera `docker run -d --tmpfs <PGDATA> --label nava-ci=1 --cpu-shares 512 --memory 768m <misma imagen y versión que el CI actual>`. Espera con `docker exec <pg> pg_isready -h 127.0.0.1` y corre el check con `--network container:<pg>`, para que la base quede en `127.0.0.1:5432`, como en Actions.
   - Un `trap` borra los contenedores al salir, también si falla.
4. **Checks** en `tools/ci/checks/*.sh`: uno por job de Actions, partido si así corre en paralelo sin duplicar trabajo.
5. **`deploy/jenkins/deploy.Jenkinsfile`**, con parámetros `SHA` (vacío = punta de `main`) y `AUTO`:
   - `disableConcurrentBuilds()` **sin** `abortPrevious`, para que un despliegue no se corte a medias. `timeout` de 45 min.
   - `environment { GITHUB_REPO = '<REPO>'; PUBLIC_URL = '<url o vacío>' }` en el propio pipeline. Los globales de Jenkins `GITHUB_REPO` y `PUBLIC_URL` son de barbería: no los uses ni los cambies.
   - Etapas `Verificar commit` → `Imagen` → `Desplegar` → `Comprobar`, con `deploy/jenkins/release.sh <fase>` adaptado del de barbería. Las etapas después de `Verificar` se saltan si existe `.release/skip`.
   - `verify` con `AUTO=false` acepta el SHA si `continuous-integration/jenkins/branch` está en `success`, o si es anterior a la migración y los check runs de los jobs de Actions que lo probaron están en verde. Los nombres exactos están en _Particularidades_.
   - `images` construye en un `git worktree` en el SHA y omite el `docker build` si la etiqueta ya existe.
   - `deploy` envía `deploy/compose.yaml` y `deploy/deploy.sh` del SHA a `/srv/<proyecto>/releases/<sha>`, apunta `current` a esa carpeta (`ln -sfn`) y ejecuta `deploy.sh <sha>` como `deploy`.
6. **`deploy/deploy.sh`**: que use la imagen local si existe y solo haga `pull` si falta. Conserva respaldos, salud, vuelta atrás y limpieza. Ver _Particularidades_.
7. Elimina `.github/workflows/*.yml` y actualiza la documentación de despliegue del proyecto:
   - dónde está el CI/CD;
   - qué corre según qué cambia;
   - cómo redesplegar o volver atrás;
   - cómo apagar el despliegue automático (desactivar `<proyecto>/deploy`).

### B. En `bcaceres19/barberia` (PR aparte, con su issue)

1. En `deploy/jenkins/casc/jobs.groovy`, añade `folder('<proyecto>')`, `multibranchPipelineJob('<proyecto>/ci')` y `pipelineJob('<proyecto>/deploy')`, copiando los de `barberia/`:
   - `repository('<repo>')`, un `id` de fuente único, `scriptPath('deploy/jenkins/deploy.Jenkinsfile')`;
   - `headWildcardFilter('main PR-*')`, `periodicFolderTrigger('5m')` y estrategias 1/1.
2. Actualiza `deploy/jenkins/README.md`, en la tabla de pipelines.
3. Añade una nota a `DEC-177` en `docs/00-control/registro-decisiones.md`, sube la versión del documento y añade una fila en `docs/00-control/historial-cambios.md`, según el `AGENTS.md` de barbería.
4. Integra con squash cuando el CI de barbería esté en verde: solo cambian `deploy/` y `docs/`, así que su plan corre `deploy`. Luego aplica en la VPS, como dice el README:

   ```bash
   # desde la copia de barberia ya en main
   tar -C deploy/jenkins -czf - . | ssh barberia-vps 'sudo tar xzf - -C /srv/jenkins/stack && sudo chown -R root:root /srv/jenkins/stack'
   ssh barberia-vps 'sudo bash /srv/jenkins/stack/scripts/jenkins-up.sh'
   ```

   Verifica en la API que existen `job/<proyecto>/job/ci` y `job/<proyecto>/job/deploy`. Si el README usa otra ruta o comando, manda el README.

**Orden:** integra B primero; sin eso, los jobs no existen. El escaneo de `<proyecto>/ci` no encontrará `Jenkinsfile` en `main` hasta que se integre A, y eso es esperado: el PR de A sí se construye, porque `PR-*` usa el `Jenkinsfile` del propio PR.

### C. Webhook en `<REPO>`

`https://jenkins.nava.wtf/github-webhook/`, `content_type=json`, eventos `push` y `pull_request`, con el secreto de `/srv/jenkins/secrets/GITHUB_WEBHOOK_SECRET`. El secreto nunca va en la línea de comandos ni en un log:

```bash
ssh barberia-vps 'sudo cat /srv/jenkins/secrets/GITHUB_WEBHOOK_SECRET' \
  | jq -R '{name:"web",active:true,events:["push","pull_request"],config:{url:"https://jenkins.nava.wtf/github-webhook/",content_type:"json",insecure_ssl:"0",secret:.}}' \
  | gh api repos/<REPO>/hooks --input - --jq '.id'
```

Comprueba que el `ping` y el primer `push` aparecen con `200` en `gh api repos/<REPO>/hooks/<id>/deliveries`.

## Fuera de alcance

- Cambiar la aplicación, sus pruebas o sus umbrales. Si una prueba falla en Jenkins, antes averigua por qué: ver _Trampas_. No la borres, no la marques como skip, no amplíes la lista de `--ignore` y no bajes la cobertura.
- Tocar contenedores, redes, datos o volúmenes de otros proyectos, o el Caddy de barbería.
- Montar un registro de imágenes o un agente de Jenkins separado.
- Borrar paquetes de GHCR, entornos o secretos de GitHub: **pide confirmación** al propietario antes.

## Rendimiento: lecciones de barbería (#625)

El CI de barbería pasó de 8–12 min a ~4 min sin quitar pruebas. El merge de un PR al día con `main` llega a producción en ~1 min. Aplica lo mismo:

1. **No repetir trabajo.** Registra el árbol verificado y sáltate los checks si vuelve a aparecer. Reglas por ruta para los PR; una ruta sin regla ejecuta todo.
2. **Paralelo, con la CPU en cuenta.** Todos los checks a la vez, cada uno con `--cpu-shares 512`. Con 4 vCPU saturadas, paralelizar no reduce el trabajo, solo lo reparte: elimina el trabajo duplicado, como compilar dos veces o instalar dependencias en cada check.
3. **Cachés que sobreviven.** Monta en ruta fija (`/workspace`) y guarda en el volumen las cachés de uv, npm, pip o mypy. La caché de mypy debe ser por contenido o vivir en el workspace; no confíes en una caché que omita archivos cambiados.
4. **Reparto por archivos.** pytest-xdist y vitest reparten por archivo o por prueba según la herramienta: un archivo enorme fija el mínimo. Mide antes de partir nada, y parte solo si lo justifica.
5. **Mide en la VPS**, no en tu máquina: las vCPU son ~2× más lentas que los runners de GitHub. Si un timeout de prueba se queda corto por lentitud **demostrada**, sube el del runner solo en el CI y explícalo en un comentario.

## Trampas ya resueltas en barbería (léelas antes de depurar)

1. **Permisos:** un script nuevo en `tools/ci/` debe guardarse con modo `100755` en git (`git ls-files -s tools/ci`). Si no, la etapa falla con exit code 126.
2. **SELinux:** sin `--security-opt label=disable`, el contenedor no puede leer el workspace montado (`Permission denied`). No uses `:z`/`:Z`: re-etiquetarían el `JENKINS_HOME` compartido.
3. **UID:** corre los checks como `--user 1000:1000`. Si no, dejan en el workspace archivos de root que el siguiente build no puede borrar.
4. **Credenciales de git en `sh`:** los pasos `sh` **no** heredan las credenciales del checkout, y un `git fetch` falla con `could not read Username`. Usa `withCredentials([usernamePassword(credentialsId: 'github-token', usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')])` y un helper que lea el entorno: `git -c credential.helper= -c 'credential.helper=!f() { echo "username=$GH_USER"; echo "password=$GH_TOKEN"; }; f' fetch ...`.
5. **CPU:** usa `--cpu-shares 512`, nunca `--cpus`: la cuota estrangula a Node, Go y Python, que dimensionan sus hilos por los núcleos del host.
6. **Base de un PR desactualizada:** Jenkins fusiona el PR con el `base.sha` que GitHub guardó al abrirlo, no con el `main` actual. Si `main` avanzó y el resultado no cuadra, ejecuta `gh pr update-branch <n>` y reescanea.
7. **`abortPrevious`:** un push nuevo aborta el build en curso del mismo PR o rama. Espera a que acabe si necesitas su resultado.
8. **Despliegue de un commit viejo:** con `AUTO=true`, si el SHA ya no es la punta de `main`, el despliegue se omite (`.release/skip`).
9. **Sin checks obligatorios:** el plan gratuito no permite exigir checks en un repo privado. Integra solo con `continuous-integration/jenkins/pr-merge` en `success`.
10. **Imágenes:** Jenkins construye con `docker build` en el Docker del host y etiqueta `ghcr.io/bcaceres19/<imagen>:<sha>`, así que `compose.yaml` no cambia. Una imagen con estado nunca se reconstruye con la misma etiqueta.
11. **SSH al host:** `ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/secrets/DEPLOY_KNOWN_HOSTS deploy@10.89.10.1 ...`. Envía archivos con `tar ... | ssh ... "tar x -C ..."`: una sola conexión, y conserva los permisos.
12. **API de Jenkins sin interfaz** (diagnóstico): `ssh barberia-vps "sudo docker exec jenkins-controller-1 sh -c 'curl -gfsS -u admin:\$(cat /run/secrets/ADMIN_PASSWORD) http://127.0.0.1:8080/job/<proyecto>/job/ci/job/PR-<n>/lastBuild/consoleText'"`. Los tiempos por etapa están en `.../lastBuild/wfapi/describe`. La contraseña nunca va a un log ni al chat.
13. **shellcheck:** un comentario que empieza por `# shellcheck` se interpreta como directiva (SC1073). Redáctalo de otra forma.

## Particularidades verificadas (2026-11-16; vuelve a comprobarlas)

### `bcaceres19/odin-pedidos` (`<proyecto>` = `pedidos`)

- **Stack:** Node 22 y npm (`package-lock.json`), sin `AGENTS.md`. Imagen `ghcr.io/bcaceres19/odin-pedidos:<sha>` (~240 MB).
- **Actions hoy:**
  - `tests.yml`: job `test`, que ejecuta `npm ci` y `npm test` con PostgreSQL `16-alpine` de servicio y `TEST_DATABASE_URL=postgresql://pedidos:pedidos@127.0.0.1:5432/pedidos_test`.
  - En el mismo workflow, job `Imagen, compose de producción y shellcheck`: `shellcheck deploy/*.sh`, `docker compose -f deploy/compose.yaml config --quiet` con un env de relleno (`IMAGE_TAG=ci`, `PEDIDOS_ENV_DIR`), e imagen sin publicar.
  - `deploy.yml`: `workflow_run` y `workflow_dispatch` con SHA; entorno `production` con URL `https://pedidos.nava.wtf`.
- **`deploy/deploy.sh`:** **ya** usa la imagen local si existe («ya está en el VPS») y solo hace `pull` si falta. Con Jenkins construyendo antes, no hace falta tocarlo, salvo el comentario sobre el login a GHCR. Además:
  - hace respaldo previo con `pg_dump`;
  - comprueba la salud desde la red `edge` (`pedidos:8080/healthz`);
  - si falla, vuelve a la versión anterior;
  - conserva solo las imágenes actual y anterior.
- **`PUBLIC_URL`:** `https://pedidos.nava.wtf`. La comprobación es `GET $PUBLIC_URL/healthz`, que pasa por el Caddy de barbería.
- **Secretos de GitHub:** `VPS_HOST`, `VPS_KNOWN_HOSTS`, `VPS_SSH_KEY` (entorno `production`).
- **Check runs heredados para `verify`:** `test` e `Imagen, compose de producción y shellcheck`.

### `bcaceres19/odin` (`<proyecto>` = `odin`)

- **Stack:** Python con uv (`uv.lock`, `.python-version`).
- **Reglas propias:** tiene `AGENTS.md`, que exige Ruff, mypy y pytest, y pruebas de PostgreSQL con rol runtime sin superuser, owner ni BYPASSRLS. Léelo entero. La autorización para el PR de barbería está en la instrucción de arriba.
- **Imagen:** `ghcr.io/bcaceres19/odin:<sha>` (~1,7 GB), construida desde el `Dockerfile` de la raíz. La primera construcción en la VPS será lenta: aprovecha la caché de BuildKit y no reconstruyas si la etiqueta existe.
- **Actions hoy** (`ci-cd.yml`):
  - `Ruff, mypy y pruebas`: `uv sync --frozen`; `ruff check src tests scripts`; `mypy src scripts`; `pytest -q -m "not integration and not live"` con su lista de `--ignore` (se copia **tal cual**). Variables de relleno: `ODIN_DATABASE_URL=postgresql://unused`, `ODIN_TENANT_ID=11111111-1111-1111-1111-111111111111`.
  - `PostgreSQL con rol runtime`: `pgvector/pgvector:0.8.7-pg17-bookworm` con `POSTGRES_USER=odin_owner`. Crea el rol `odin_app LOGIN ... NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` y ejecuta `pytest -q tests/integration` con `ODIN_INTEGRATION=1`, `ODIN_ADMIN_DATABASE_URL` y `ODIN_DATABASE_URL`.
  - `Construir y publicar imagen`: publica `:sha` y `:latest` en GHCR. El `:latest` deja de existir; comprueba que nada lo usa (`compose.yaml` usa `${IMAGE_TAG:?}`).
  - `Desplegar en el VPS`: `scp` de `compose.yaml` y `deploy.sh`, y `ln -sfn` de `current`.
- **`deploy/deploy.sh`:** **siempre** hace `dc "$tag" pull app`, con un login a GHCR que ya no existirá. Cámbialo para que solo descargue si la imagen no está en el host, como hace pedidos. Además:
  - Hoy solo limpia imágenes colgantes (`docker image prune -f`), y en el host ya hay ~10 imágenes de Odin de 1,7 GB. Haz que conserve solo la actual y la anterior, como pedidos, sin tocar imágenes de otros proyectos.
  - Conserva la base (`up --wait db`), las migraciones (`run --rm migrate`, perfil `tools`), el arranque con `--wait` y la vuelta a la versión anterior.
- **Sin URL pública propia:** el túnel `cloudflared` es opcional y de URL efímera. La salud la comprueba el healthcheck del contenedor (`odin health`) a través de `up --wait`. Deja `PUBLIC_URL` vacío y haz que `Comprobar` verifique, por SSH, que el contenedor `app` de la pila `odin` está `healthy` con la imagen `:<sha>`.
- **Red compartida:** Odin está en la red `odin-pedidos` junto con pedidos. No la toques.
- **Secretos de GitHub:** `VPS_HOST`, `VPS_KNOWN_HOSTS`, `VPS_SSH_KEY`, `VPS_USER` (de repo, no de entorno).
- **Check runs heredados para `verify`:** `Ruff, mypy y pruebas` y `PostgreSQL con rol runtime`.

## Pruebas y evidencia

- El PR A muestra en GitHub el estado `continuous-integration/jenkins/pr-merge` en verde, con enlace al build y tabla `check de Actions → etapa de Jenkins → resultado`, sin huecos.
- `plan.sh` probado con los casos sintéticos de A.2. Pega la salida.
- Prueba negativa: en una rama desechable, rompe a propósito una prueba y comprueba que Jenkins publica `failure`. No la integres; bórrala después **con confirmación**.
- Tras integrar A:
  - el build de `main` dispara `<proyecto>/deploy` con `AUTO=true` y termina en `SUCCESS`;
  - el contenedor `app` queda `healthy` con la imagen del SHA nuevo;
  - en pedidos, además, `https://pedidos.nava.wtf/healthz` responde 200.
- Un PR siguiente al día con `main` y su merge: el build de `main` dice `árbol … ya verificado` y despliega sin checks. Mide el tiempo del merge a producción.
- Un redespliegue manual del mismo SHA (`AUTO=false`) termina en `SUCCESS` sin reconstruir la imagen.
- Webhook con `ping` y `push` en 200.
- `shellcheck -x -S warning` limpio en los scripts nuevos o tocados.
- Tiempos de cada etapa del CI completo frente a los de Actions.

## Verificación final

Entrega una tabla:

`Criterio | Estado | Prueba o evidencia`

No declares cumplido nada que no hayas visto pasar. Si un despliegue falla, la aplicación en ejecución debe seguir intacta, porque `deploy.sh` ya protege eso. Repórtalo con el log.

## Git y PR

- Commits y PR en Conventional Commits:
  - en `<REPO>`: `ci: migrar el CI/CD de GitHub Actions a Jenkins en la VPS`;
  - en barberia: `ci(jenkins): registrar los jobs de <proyecto>`.
- `Closes #<issue>` en cada PR de su repositorio. Sin push directo, force push ni reescritura de `main`. Squash cuando todos los checks estén en verde.
- Al terminar, pregunta al propietario si quiere borrar los secretos y entornos de GitHub sin uso y los paquetes de GHCR antiguos.
