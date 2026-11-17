# Jenkins de la VPS

CI/CD propio de la VPS (`DEC-177`), en `https://jenkins.nava.wtf`. Sustituye a GitHub Actions para
la barbería y está pensado para recibir también los demás proyectos de la máquina (una carpeta de
jobs por proyecto). Todo es código: imagen, plugins, configuración (JCasC) y jobs (Job DSL) viven en
esta carpeta; lo que se cambie en la interfaz se pierde al reiniciar.

## 1. Piezas

```text
GitHub ──webhook──▶ Caddy (jenkins.nava.wtf) ── red edge ──▶ jenkins:8080
   ▲                                                           │ socket de Docker del host
   └── estado del commit, clonado (token) ◀────────────────────┤
                                                               ├─▶ contenedores de prueba (tools/ci)
                                                               ├─▶ docker build de las imágenes
                                                               └─▶ ssh deploy@10.89.10.1 → deploy.sh
```

| Archivo | Qué es |
| --- | --- |
| [`compose.yaml`](compose.yaml) | pila `jenkins`: controlador, red `ci` (10.89.10.0/24) y red externa `edge` |
| [`controller.Dockerfile`](controller.Dockerfile), [`plugins.txt`](plugins.txt) | Jenkins LTS fijado + Docker CLI (compose, buildx), git, ssh, jq |
| [`casc/jenkins.yaml`](casc/jenkins.yaml) | seguridad, credenciales, URL y webhook |
| [`casc/jobs.groovy`](casc/jobs.groovy) | carpetas y jobs |
| [`pipelines/`](pipelines) | `deploy.Jenkinsfile` y `maintenance.Jenkinsfile` (el CI es el [`Jenkinsfile`](../../Jenkinsfile) de la raíz) |
| [`scripts/`](scripts) | instalación (`jenkins-init.sh`), secretos (`jenkins-secret-set.sh`), arranque (`jenkins-up.sh`) y fases del despliegue (`release.sh`) |
| [`../../tools/ci/`](../../tools/ci) | imagen de herramientas del CI, lanzador de checks y construcción de imágenes |

En el servidor:

| Ruta | Dueño | Contenido |
| --- | --- | --- |
| `/srv/jenkins/stack/` | root | copia de esta carpeta (desde donde se construye y arranca) |
| `/srv/jenkins/home/` | UID 1000 | `JENKINS_HOME`, montado en la **misma ruta** dentro del contenedor |
| `/srv/jenkins/secrets/` | UID 1000, 700/600 | un archivo por secreto, montado en `/run/secrets` |
| `/srv/jenkins/stack.env` | root | `DOCKER_GID` (grupo `docker` del host) |

## 2. Pipelines

| Job | Disparo | Qué hace |
| --- | --- | --- |
| `barberia/ci` (multibranch) | webhook de GitHub (push y PR); escaneo cada 5 min de respaldo | solo `main` y los PR. `tools/ci/plan.sh` decide los checks (ver abajo); todos corren a la vez, cada uno en un contenedor de `tools/ci/ci.Dockerfile` con prioridad baja de CPU; Go y SQL con un PostgreSQL 14 efímero. Después, las imágenes (en `main` siempre). Estado en el commit: `continuous-integration/jenkins/branch` (main) o `…/pr-merge` (PR). En `main`, si pasa, dispara `barberia/deploy` |
| `barberia/deploy` | el CI de `main` (`AUTO=true`); a mano con `SHA` | verifica que el SHA sea de `main` y que su CI esté en verde (a mano consulta GitHub; también acepta commits anteriores a la migración que pasaron en Actions). Con `AUTO=true` se omite si `main` ya avanzó. Worktree en el SHA → imágenes que falten → tar a `/srv/barberia/releases/<sha>` → `deploy.sh --no-pull` → `GET https://nava.wtf/health` |
| `pedidos/ci` (multibranch) | webhook de `bcaceres19/odin-pedidos`; escaneo cada 5 min | mismo patrón que `barberia/ci` con el `Jenkinsfile` de ese repo: `npm test` con PostgreSQL 16 efímero, shellcheck y `deploy/compose.yaml` en paralelo; imagen `ghcr.io/bcaceres19/odin-pedidos:<sha>` (en `main` siempre). Árboles verificados en `$JENKINS_HOME/pedidos-ci-green/`. En `main`, si pasa, dispara `pedidos/deploy` |
| `pedidos/deploy` | el CI de `main` (`AUTO=true`); a mano con `SHA` | `deploy/jenkins/deploy.Jenkinsfile` de ese repo: verifica el SHA (también commits que pasaron en Actions), imagen si falta, `compose.yaml` y `deploy.sh` a `/srv/pedidos/releases/<sha>` → `current` → `deploy.sh <sha>` (respaldo, salud por `edge`, vuelta atrás) → `GET https://pedidos.nava.wtf/healthz` |
| `vps/mantenimiento` | diario, ~04:00 | borra contenedores de CI de más de 3 h, caché de construcción de más de 7 días e imágenes colgantes; muestra el uso de disco |

Los demás proyectos traen su CI/CD en su propio repositorio (`Jenkinsfile`, `tools/ci/`, `deploy/jenkins/`) y
aquí solo se registran sus jobs; sus variables propias (`GITHUB_REPO`, `PUBLIC_URL`) van en el `environment` de su
pipeline, porque las globales de abajo son de la barbería. Lo que sigue describe los checks de la barbería.

Checks del CI (los mismos del antiguo `ci.yml`): `tools/ci/checks/go.sh`, `openapi.sh`, el frontend
partido en `web-deps.sh` (instalación, una vez) + `web-static.sh` (formato, lint, tipos) +
`web-test.sh` (vitest); el build de producción del frontend lo comprueba la imagen web, `database.sh`, `shellcheck.sh` y `tools/ci/compose-check.sh`. Una migración
nueva se añade a la lista explícita de `go.sh` (Atlas la valida en `database.sh`). Se pueden correr en
local con Docker: `tools/ci/run.sh go --postgres`.

**Qué checks corren (`tools/ci/plan.sh`, #625).** Primero, si el mismo árbol de git ya pasó un CI
completo, no se repite nada: es lo normal tras el squash-merge de un PR al día con `main`, que así se
despliega en un par de minutos. Si no, se comparan los archivos con la base (en un PR, el `main` con el
que se fusiona; en `main`, el commit anterior, y solo si ese commit ya estaba verificado):

| Cambia | Corre |
| --- | --- |
| `docs/`, `.agents/`, `.claude/`, `.github/`, `*.md`/`*.docx`/`*.txt` de la raíz | nada |
| `apps/web/` | frontend (+ imágenes) |
| `apps/api/` | Go (+ imágenes) |
| `api/` (OpenAPI) | OpenAPI y Go (pruebas de contrato) |
| `database/` | Atlas + SQL y Go |
| `deploy/` | shellcheck y compose (+ imágenes) |
| `package.json`, `pnpm-lock.yaml`, `redocly.yaml` de la raíz | OpenAPI |
| `Jenkinsfile`, `tools/ci/`, `.gitattributes` o cualquier otra ruta | todo |

Un check omitido aparece como *skipped* y la descripción del build dice por qué. Los árboles
verificados se guardan en `$JENKINS_HOME/nava-ci-green/` (30 días); borrar esa carpeta obliga a
repetir el CI completo.

## 3. Secretos y variables

| Archivo en `/srv/jenkins/secrets` | Credencial / uso | Origen |
| --- | --- | --- |
| `ADMIN_PASSWORD` | usuario `admin` de Jenkins | aleatorio (`jenkins-init.sh`) |
| `GITHUB_TOKEN` | `github-token` y `github-token-text`: clonado, PR y estados | token de `gh` de `bcaceres19` (sustituible por uno fino: *Contents* lectura, *Commit statuses* escritura, *Pull requests* lectura) |
| `GITHUB_WEBHOOK_SECRET` | `github-webhook-secret`: firma HMAC del webhook | aleatorio |
| `DEPLOY_SSH_KEY` | `vps-deploy-ssh`: entrar como `deploy` | generada; autorizada en `~deploy/.ssh/authorized_keys` con `restrict,from="10.89.10.0/24"` |
| `DEPLOY_KNOWN_HOSTS` | huella del host para esa conexión | `/etc/ssh/ssh_host_ed25519_key.pub` |
| `MAPS_BROWSER_KEY` | `maps-browser-key` → `VITE_GOOGLE_MAPS_BROWSER_KEY` de la imagen web | la variable del antiguo entorno `production` de GitHub |

Variables globales (JCasC): `PUBLIC_URL=https://nava.wtf` y `GITHUB_REPO=bcaceres19/barberia`.
Las claves de la aplicación (Resend, Meta, Google) **no** pasan por Jenkins: siguen en
`/srv/barberia/secrets` (`DEC-159`).

Ver la contraseña de `admin`: `ssh barberia-vps 'sudo cat /srv/jenkins/secrets/ADMIN_PASSWORD'`.
Cambiar un secreto (lee de stdin, sin eco) y aplicarlo:

```bash
ssh -t barberia-vps 'sudo bash /srv/jenkins/stack/scripts/jenkins-secret-set.sh GITHUB_TOKEN'
ssh barberia-vps 'sudo bash /srv/jenkins/stack/scripts/jenkins-up.sh --restart'
```

## 4. Instalación (una vez) y actualización

1. DNS: registro `A` `jenkins` → `158.69.232.180` (TTL 300) en Hostinger. El certificado lo emite
   el Caddy de la barbería en cuanto el registro existe y su `Caddyfile` incluye el sitio.
2. Copiar esta carpeta y preparar secretos, llave y directorios:
   ```bash
   tar -C deploy/jenkins -czf - . | ssh barberia-vps 'sudo install -d -m 755 /srv/jenkins/stack && sudo tar xzf - -C /srv/jenkins/stack && sudo chown -R root:root /srv/jenkins/stack'
   ssh barberia-vps 'sudo bash /srv/jenkins/stack/scripts/jenkins-init.sh'
   gh auth token | ssh barberia-vps 'sudo bash /srv/jenkins/stack/scripts/jenkins-secret-set.sh GITHUB_TOKEN'
   gh variable get VITE_GOOGLE_MAPS_BROWSER_KEY --env production | tr -d '\n' \
     | ssh barberia-vps 'sudo bash /srv/jenkins/stack/scripts/jenkins-secret-set.sh MAPS_BROWSER_KEY'
   ```
   (`jenkins-init.sh` corre como root porque crea `/srv/jenkins` y autoriza la llave en la cuenta
   de `deploy`. El paso 1 con `install -d` solo hace falta la primera vez.)
3. Arrancar: `ssh barberia-vps 'sudo bash /srv/jenkins/stack/scripts/jenkins-up.sh'`.
4. Webhook en GitHub (`https://jenkins.nava.wtf/github-webhook/`, JSON, eventos *push* y
   *pull_request*, con el secreto de `GITHUB_WEBHOOK_SECRET`):
   ```bash
   ssh barberia-vps 'sudo cat /srv/jenkins/secrets/GITHUB_WEBHOOK_SECRET' \
     | jq -R '{name:"web",active:true,events:["push","pull_request"],config:{url:"https://jenkins.nava.wtf/github-webhook/",content_type:"json",insecure_ssl:"0",secret:.}}' \
     | gh api repos/bcaceres19/barberia/hooks --input -
   ```

**Actualizar Jenkins** (plugins, JCasC, jobs o versión): cambiar esta carpeta por PR y, ya en `main`,
repetir la copia del paso 2 y `jenkins-up.sh`. No se hace desde un pipeline: reiniciar el controlador
corta su propia ejecución. Subir el LTS es cambiar la etiqueta de `controller.Dockerfile`.

**Acceso de emergencia** (sin DNS o con Caddy caído): `ssh -L 8090:127.0.0.1:8090 barberia-vps` y
abrir `http://localhost:8090`.

## 5. Operación

```bash
ssh barberia-vps 'sudo docker logs --tail=100 jenkins-controller-1'   # registro del controlador
ssh barberia-vps 'sudo docker stats --no-stream'                      # consumo frente a producción
```

- **Apagar el despliegue automático:** *Barbería → Deploy → Disable Project* (el CI sigue corriendo).
- **Reintentar o volver atrás:** *Barbería → Deploy → Build with Parameters* con el SHA de `main`.
- **Recursos:** el controlador tiene 1,5 CPU y 1,5 GB. Los checks corren a la vez, con prioridad de
  CPU baja (`--cpu-shares 512`, la producción tiene 1024) y topes de memoria (Go 3 GB, pruebas del
  frontend 2,5 GB, estático del frontend 2 GB, el resto 1 GB, PostgreSQL 768 MB), sin cuota fija de
  CPU: Node y Go dimensionan sus hilos por los núcleos del host y una cuota los estrangula. vitest usa
  hilos y 10 s por prueba (`web-test.sh`). Las imágenes se construyen después de los checks.
- **Cachés:** el workspace se monta siempre en `/workspace` dentro del check, así que la caché de Go
  (también la de resultados de pruebas) sirve entre ramas y PR. Las pruebas de Go con base de datos se
  invalidan cuando cambian las migraciones o el testdata (su huella va en la URL de la base).
- **Disco:** `JENKINS_HOME` (workspaces con `node_modules`), el volumen `nava-ci-cache` (módulos de
  Go y pnpm) y la caché de BuildKit. `vps/mantenimiento` limpia lo de más de 7 días.

## 6. Seguridad

- El socket de Docker equivale a root en la VPS: quien administre Jenkins o ejecute código en un
  pipeline (cualquier PR) lo es. Por eso: sin usuarios anónimos ni registro, solo `admin`, sin puerto
  de agentes, HTTPS por Caddy y el puerto directo solo en el loopback del host. Un repositorio con
  colaboradores externos exigiría aprobar los PR antes de construirlos.
- El webhook se acepta solo con la firma HMAC correcta.
- La llave SSH de Jenkins solo entra como `deploy` y solo desde su red (`from="10.89.10.0/24"`), sin
  terminal ni reenvíos.
- Ningún secreto vive en el repositorio ni en la configuración de los jobs: los lee JCasC de
  `/run/secrets` y los pipelines los reciben enmascarados con `withCredentials`.
