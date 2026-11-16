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
| `barberia/ci` (multibranch) | webhook de GitHub (push y PR); escaneo cada 5 min de respaldo | solo `main` y los PR. Cada check en un contenedor de `tools/ci/ci.Dockerfile` con prioridad baja de CPU; Go y SQL con un PostgreSQL 14 efímero. Después, las tres imágenes. Estado en el commit: `continuous-integration/jenkins/branch` (main) o `…/pr-merge` (PR). En `main`, si pasa, dispara `barberia/deploy` |
| `barberia/deploy` | el CI de `main` (`AUTO=true`); a mano con `SHA` | verifica que el SHA sea de `main` y que su CI esté en verde (a mano consulta GitHub; también acepta commits anteriores a la migración que pasaron en Actions). Con `AUTO=true` se omite si `main` ya avanzó. Worktree en el SHA → imágenes que falten → tar a `/srv/barberia/releases/<sha>` → `deploy.sh --no-pull` → `GET https://nava.wtf/health` |
| `vps/mantenimiento` | diario, ~04:00 | borra contenedores de CI de más de 3 h, caché de construcción de más de 7 días e imágenes colgantes; muestra el uso de disco |

Checks del CI (equivalentes uno a uno a los jobs del antiguo `ci.yml`): `tools/ci/checks/go.sh`,
`openapi.sh`, `web.sh`, `database.sh`, `shellcheck.sh` y `tools/ci/compose-check.sh`. Una migración
nueva se añade a la lista explícita de `go.sh` (Atlas la valida en `database.sh`). Se pueden correr en
local con Docker: `tools/ci/run.sh go --postgres`.

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
- **Recursos:** el controlador tiene 1,5 CPU y 1,5 GB; los checks, prioridad de CPU baja y límites
  propios (Go 2 CPU/3 GB, web 1,5/2 GB, SQL 1/1 GB, PostgreSQL 1/768 MB). Las imágenes se construyen
  tras los checks, no en paralelo con ellos.
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
