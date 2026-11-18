# Despliegue de Nava Agenda

Pila de producción en contenedores Docker sobre un VPS: proxy con HTTPS, API, worker,
PostgreSQL y respaldos. Todo se despliega desde el Jenkins de la propia VPS
(`DEC-177`; infraestructura en [`nava-project/nava-jenkins`](https://github.com/nava-project/nava-jenkins), `DEC-184`) con el mismo commit que superó el CI. Decisiones de base: [`stack-despliegue-operacion.md`](../docs/04-arquitectura/stack-despliegue-operacion.md)
y [`migraciones-atlas.md`](../docs/05-backend/migraciones-atlas.md).

> **Nombres desde `DEC-183` (#664).** Repositorio `nava-project/nava-agenda` (transferido desde `bcaceres19`, #687; GitHub redirige la URL
> vieja), carpeta de Jenkins `agenda/` (`agenda/ci`, `agenda/deploy`), imágenes
> `nava-agenda-{web,backend,db}` y raíz del servidor `/srv/nava-agenda`. La raíz se movió una sola vez
> con `sudo mv /srv/barberia /srv/nava-agenda`, cambiando `NAVA_ENV_DIR`/`NAVA_BACKUP_DIR` en
> `stack.env`. El enlace de compatibilidad `/srv/barberia` se retiró tras el primer despliegue con las
> rutas nuevas: las versiones anteriores a `50d7b1b8` tienen la ruta vieja fija y no sirven para volver
> atrás. Los volúmenes de Docker (`nava_db-data`,
> `nava_caddy-*`) y el proyecto compose `nava` no cambian de nombre. Alias SSH: `nava-vps` y
> `nava-deploy` (los viejos `barberia-*` siguen en `~/.ssh/config`).

## 1. Arquitectura

```text
Internet ──443/80──▶ web (Caddy: HTTPS, SPA, /api → api)   agenda.nava.wtf (DEC-183)
                       │  red "app" (interna)
                       ▼
                      api ──────────┐
                                    │ red "data" (interna, sin salida)
                     worker ────────┼──▶ db (PostgreSQL, TLS + SCRAM)
                     backup ────────┘        ▲
                                             │ pg_dump diario → /srv/nava-agenda/backups
                     migrate (bajo demanda) ─┘

api y worker salen a Internet (Resend, Meta, Google) por la red "egress".

Internet ──443──▶ web (Caddy) ── red "edge" (externa, compartida) ──▶ pedidos:8080
                  pedidos.nava.wtf                                      (pila aparte)
                  jenkins.nava.wtf ──────────────────────────────────▶ jenkins:8080
                                                                        (pila aparte, DEC-177)
                  nexos.nava.wtf ── red "nexos-edge" (solo Nexos) ──▶ nexos:7870
                  (solo /webhooks/whatsapp)                             (pila aparte, #679)
```

**Webhook de WhatsApp de Nava Nexos (#679, ADR 027 de `nava-project/nava-nexos`).** El sitio `nexos.{$DOMAIN}` solo deja pasar `GET`/`POST /webhooks/whatsapp` hacia `nexos:7870`, con cuerpo de hasta 1 MB; cualquier otra ruta responde 404 en el propio Caddy. Llega por la red externa `nexos-edge`, separada de `edge` para que Pedidos, Jenkins y la landing no alcancen el simulador ni los otros webhooks de Nexos. `deploy.sh` crea esa red si falta. La firma HMAC de Meta la valida Nexos.

**Landing en `nava.wtf` (`DEC-183`, #658).** La app vive en `agenda.nava.wtf`. `nava.wtf` sirve la landing de la familia NAVA y `/privacidad` y `/terminos` desde el repo `nava-project/nava` (pila `nava-landing` en `/srv/nava`, alias `nava-landing` en `edge`, jobs `nava/ci` y `nava/deploy`). En `nava.wtf`, las rutas de la app (`/acceso`, `/recuperar-acceso`, `/panel/*`, `/reservar/*`, `/mi-turno/*`) redirigen con 308 a `agenda.nava.wtf` con la misma ruta; el API ya no responde en `nava.wtf` (#685). En `agenda.nava.wtf`, `/privacidad` y `/terminos` redirigen a `nava.wtf`.

**Otros proyectos en la misma VPS (`DEC-176`).** Este Caddy es el único dueño de 80/443.
Nava · Pedidos (repo `nava-pedidos`, pila `pedidos` en `/srv/pedidos`) no publica puertos:
se une a la red Docker externa `edge` con el alias `pedidos`, y el sitio `pedidos.{$DOMAIN}`
del [`Caddyfile`](caddy/Caddyfile) le hace proxy a `pedidos:8080` (HSTS, `nosniff`, cuerpo
de hasta 6 MB para los comprobantes y SSE sin búfer). De esta pila solo `web` entra en
`edge`; el API, el worker y la base no son alcanzables desde ahí. `deploy.sh` crea la red si
falta y nunca la borra. Si Pedidos está caído, solo su subdominio responde 502. Ningún
contenedor de `edge` debe usar los alias `api`, `web`, `db` o `worker`: Caddy los resolvería
también por esa red. Odin (`/srv/odin`) no pasa por aquí: sale por su propio túnel.

| Servicio | Imagen | CPU | Memoria | Función |
| --- | --- | --- | --- | --- |
| `web` | `nava-agenda-web` | 0,5 | 256 MB | Caddy: HTTPS automático, SPA de Vue, proxy `/api/*` |
| `api` | `nava-agenda-backend` | 1,0 | 512 MB | API HTTP (`GOMEMLIMIT` 400 MiB) |
| `worker` | `nava-agenda-backend` | 0,5 | 256 MB | Recordatorios y purgas |
| `db` | `nava-agenda-db` | 1,5 | 1,5 GB | PostgreSQL con TLS obligatorio |
| `backup` | `nava-agenda-db` | 0,5 | 512 MB | Respaldo diario, retención y prueba semanal |
| `migrate` | `nava-agenda-db` (Atlas 1.3.0 incluido) | 1,0 | 256 MB | Migraciones (solo durante el despliegue) |

Los límites suman ~3,1 GB de los 7,6 GB del VPS. El consumo real en reposo es una fracción
(API ~25 MB, base ~50 MB). Se ajustan en [`compose.yaml`](compose.yaml).

Seguridad de los contenedores: sistema de archivos de solo lectura, `cap_drop: ALL`,
`no-new-privileges` y usuarios sin privilegios. **Solo `web` publica puertos (80 y 443).**
Docker salta el firewall del servidor para los puertos que publica, por eso la base y el
API nunca se publican. `db` y `backup` viven en una red interna sin salida a Internet.

## 2. Configuración y secretos

Configuración y secretos van **separados** y los dos viven en el servidor, fuera del repositorio.

**Configuración** (sin secretos) en `/srv/nava-agenda/env/`, cargada con `env_file` en formato `raw`
(valor literal, sin comillas ni interpolación de `$`):

| Archivo | Lo usa | Contenido |
| --- | --- | --- |
| `stack.env` | compose | `DOMAIN`, `ACME_EMAIL`, registro de imágenes, rutas, puertos |
| `db.env` | `db` | usuario y nombre de la base |
| `app.env` | `api`, `worker` | entorno, proxies de confianza, datos no sensibles de proveedores |
| `backup.env` | `backup` | host, retención, hora, remoto de rclone |

**Secretos** como archivos de secreto de Docker, uno por secreto, en
`/srv/nava-agenda/secrets/<servicio>/<NOMBRE>` (carpetas 700, archivos 600, dueño `deploy`):

| Carpeta | Secretos |
| --- | --- |
| `db/` | `POSTGRES_PASSWORD`, `NAVA_MIGRATOR_PASSWORD`, `NAVA_APP_PASSWORD`, `NAVA_WORKER_PASSWORD`, `NAVA_BACKUP_PASSWORD` |
| `app/` | `APP_DATABASE_URL`, `APP_WORKER_DATABASE_URL`, `APP_AUTH_HMAC_SECRET`, `APP_RESEND_API_KEY`, `APP_META_WHATSAPP_ACCESS_TOKEN`, `APP_META_WEBHOOK_VERIFY_TOKEN`, `APP_META_APP_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`, `APP_ODIN_SERVICE_TOKEN` |
| `migrate/` | `DATABASE_PRODUCTION_URL`, `DATABASE_ADMIN_URL` |
| `backup/` | `PGPASSWORD` y las credenciales de rclone que añadas (`RCLONE_CONFIG_<REMOTO>_*`) |

Cada servicio monta **solo su carpeta** en `/run/secrets` (solo lectura) y el cargador
[`with-secrets`](docker/with-secrets.sh) exporta cada archivo como variable de entorno del proceso;
un archivo vacío se omite (secreto opcional sin valor). La aplicación no se modificó. Resultado
verificado: los secretos no aparecen en `docker inspect`, ni en `ps`, ni en el registro de
despliegue, y un servicio no puede leer los de otro. Los servicios que los leen corren con el UID
1001 (el de `deploy`) para poder abrir archivos 600.

- [`scripts/env-init.sh`](scripts/env-init.sh) genera configuración y secretos con valores
  aleatorios, **nunca sobrescribe** lo existente y reutiliza las contraseñas ya generadas.
- [`scripts/secret-set.sh`](scripts/secret-set.sh) guarda o reemplaza un secreto leyéndolo de la
  entrada estándar (sin eco en terminal; nunca como argumento, que quedaría en el historial y en `ps`).
- Lo que solo tú puedes dar (Resend, Meta, Google) se crea vacío; `deploy.sh` se niega a desplegar
  mientras falten los obligatorios (el API tampoco arranca sin ellos, `DEC-066`).

> **Respalda `/srv/nava-agenda/secrets/` fuera del servidor** (gestor de contraseñas). El respaldo de
> la base no lo incluye y `APP_AUTH_HMAC_SECRET` no se puede reconstruir. Para cambiar el valor de
> un secreto: `secret-set.sh` y luego `docker compose ... up -d --force-recreate api worker`.
> Rotar las contraseñas de PostgreSQL exige además `ALTER ROLE` dentro de la base.

## 3. Puesta en marcha (una sola vez)

1. **DNS** del dominio: sección 4.
2. **Jenkins** en la VPS: lo instala y opera [`nava-project/nava-jenkins`](https://github.com/nava-project/nava-jenkins) (`DEC-184`); aquí solo la sección 5.
3. **Configuración y secretos en el servidor** (genera los valores aleatorios):
   ```bash
   tar czf - deploy | ssh nava-deploy 'mkdir -p /srv/nava-agenda/bootstrap && tar xzpf - -C /srv/nava-agenda/bootstrap'
   ssh nava-deploy 'bash /srv/nava-agenda/bootstrap/deploy/scripts/env-init.sh --domain nava.wtf --acme-email TU_CORREO'
   ```
4. **Completa los proveedores.** Los secretos se guardan sin eco y sin pasar por la línea de comandos:
   ```bash
   ssh -t nava-deploy 'bash /srv/nava-agenda/bootstrap/deploy/scripts/secret-set.sh app APP_RESEND_API_KEY'
   ssh -t nava-deploy 'bash /srv/nava-agenda/bootstrap/deploy/scripts/secret-set.sh app APP_META_WHATSAPP_ACCESS_TOKEN'
   ```
   (opcionales: `APP_META_WEBHOOK_VERIFY_TOKEN`, `APP_META_APP_SECRET`, `GOOGLE_MAPS_API_KEY`, los de
   Google Calendar y `APP_ODIN_SERVICE_TOKEN`, el secreto con el que Odin consulta los turnos por
   teléfono: `HU-106`, `DEC-179`; mínimo 32 caracteres, distinto de los de Meta; lo genera el
   propietario y es el mismo valor que configura en Odin; sin él esas rutas no existen). Los datos no sensibles (`APP_META_WHATSAPP_PHONE_NUMBER_ID`,
   `APP_META_WHATSAPP_TEMPLATE_NAME`) se escriben en `/srv/nava-agenda/env/app.env`.
5. **Despliega**: no hace falta hacer nada; el primer commit que llegue a `main` con el CI en verde
   se despliega solo (o lánzalo a mano: Jenkins → *Nava Agenda* → *Deploy* → *Build with Parameters*).
   El primer despliegue crea los roles, aplica las migraciones y arranca todo.

## 4. DNS de `nava.wtf` en Hostinger

El dominio usa los nameservers de Hostinger (`*.dns-parking.com`), así que los registros se
editan en **hPanel → Dominios → nava.wtf → DNS / Servidores de nombres → Registros DNS**.

| Tipo | Nombre | Valor | TTL | Acción |
| --- | --- | --- | --- | --- |
| A | `@` | `158.69.232.180` | 300 | **Cambiar**: hoy apunta a `2.57.91.91` (página de aparcamiento de Hostinger) |
| CNAME | `www` | `nava.wtf` | 300 | Conservar (ya existe; Caddy redirige `www` al dominio sin `www`) |
| A | `pedidos` | `158.69.232.180` | 300 | Ya existe: Nava · Pedidos, servido por este Caddy (`DEC-176`) |
| A | `jenkins` | `158.69.232.180` | 300 | Jenkins de la VPS, servido por este Caddy (`DEC-177`; backend de `nava-project/nava-jenkins`, `DEC-184`) |
| A | `nexos` | `158.69.232.180` | 300 | Ya existe: webhook de WhatsApp de Nava Nexos (#679) |
| A | `agenda` | `158.69.232.180` | 300 | **Nava Agenda** (`DEC-183`): la app y su API. `nava.wtf` queda para la landing de la familia NAVA |
| CAA | `@` | `0 issue "letsencrypt.org"` | 3600 | Opcional: solo Let's Encrypt puede emitir certificados |

- **No agregues registros AAAA** (IPv6) salvo que configures IPv6 en el servidor.
- Si Hostinger muestra otros registros A, AAAA o ALIAS para `@` o `www`, elimínalos: dos IP
  distintas harían fallar el certificado de forma intermitente.
- No actives el proxy/CDN de Hostinger ni asocies un plan de hosting o creador de sitios al
  dominio: Caddy necesita llegar directo al servidor por los puertos 80 y 443 para emitir el
  certificado de Let's Encrypt.
- **Correo (Resend)**: el remitente es `no-responder@nava.wtf`. En Resend → Domains → añade
  `nava.wtf` y copia en Hostinger los registros que te indique (SPF, DKIM y MX del subdominio
  de envío). Sin verificarlo, los códigos de recuperación por correo no se entregan. Añade
  también un `TXT` `_dmarc` con `v=DMARC1; p=none; rua=mailto:TU_CORREO`.
- Comprueba: `dig +short nava.wtf` y `dig +short agenda.nava.wtf` deben responder `158.69.232.180`. El certificado se emite
  solo cuando el DNS ya apunta al servidor; si aún no, `deploy.sh` avisa y Caddy reintenta.

## 5. CI/CD (Jenkins)

El CI y los despliegues los hace el Jenkins de la VPS (`DEC-177`), en `https://jenkins.nava.wtf`.
Su infraestructura (imagen, plugins, JCasC, jobs, credenciales, `vps/mantenimiento` y la operación del
controlador) vive en [`nava-project/nava-jenkins`](https://github.com/nava-project/nava-jenkins) y la
gobierna solo la sesión orquestadora (`DEC-184`): desde aquí se **usa** Jenkins (disparar o relanzar
builds, leer registros, verificar despliegues), pero un cambio de configuración se le pide a ella. Este
repositorio conserva lo que es de Nava Agenda: el [`Jenkinsfile`](../Jenkinsfile) del CI,
[`tools/ci/`](../tools/ci) y el despliegue en [`jenkins/pipelines/deploy.Jenkinsfile`](jenkins/pipelines/deploy.Jenkinsfile)
con sus fases en [`jenkins/scripts/release.sh`](jenkins/scripts/release.sh). El job `agenda/deploy`
apunta a esas dos rutas, así que moverlas también se coordina.
GitHub Actions quedó retirado y desactivado en el repositorio (#634): GitHub ya no guarda nada necesario
para desplegar ni hay registro de imágenes.

| Pipeline | Cuándo corre | Qué hace |
| --- | --- | --- |
| `agenda/ci` | cada PR contra `main` y cada commit de `main` | los checks de [`Jenkinsfile`](../Jenkinsfile) y el estado en el commit de GitHub; en `main`, si pasa, construye las imágenes y dispara `deploy` |
| `agenda/deploy` | lo dispara el CI de `main`; a mano con un SHA | verifica que el SHA sea de `main` y que su CI de Jenkins esté en verde (los commits anteriores a la migración no se aceptan, #634); con `AUTO=true` se omite si `main` ya avanzó. Worktree en el SHA → imágenes que falten → tar a `/srv/nava-agenda/releases/<sha>` → `deploy.sh --no-pull` → `GET $PUBLIC_URL/health`. `GITHUB_REPO` y `PUBLIC_URL` (`https://agenda.nava.wtf`, #691) están en el `environment` del pipeline |

Estado en el commit: `continuous-integration/jenkins/branch` (main) o `…/pr-merge` (PR). Los checks
(los mismos del antiguo `ci.yml`) son `tools/ci/checks/go.sh`, `openapi.sh`, el frontend partido en
`web-deps.sh` (instalación, una vez) + `web-static.sh` (formato, lint, tipos) + `web-test.sh` (vitest),
`database.sh`, `shellcheck.sh` y `tools/ci/compose-check.sh`; el build de producción del frontend lo
comprueba la imagen web. Todos corren a la vez, cada uno en un contenedor de `tools/ci/ci.Dockerfile`
con prioridad baja de CPU; Go y SQL con un PostgreSQL 14 efímero. Una migración nueva se añade a la
lista explícita de `go.sh` (Atlas la valida en `database.sh`). En local con Docker:
`tools/ci/run.sh go --postgres`.

**Qué checks corren (`tools/ci/plan.sh`, #625).** Si el mismo árbol de git ya pasó un CI completo, no
se repite nada: es lo normal tras el squash-merge de un PR al día con `main`. Si no, se comparan los
archivos con la base (en un PR, el `main` con el que se fusiona; en `main`, el commit anterior, y solo
si ese commit ya estaba verificado):

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

**Recursos y cachés de los checks.** Prioridad de CPU baja (`--cpu-shares 512`, la producción tiene
1024) y topes de memoria (Go 3 GB, pruebas del frontend 2,5 GB, estático del frontend 2 GB, el resto
1 GB, PostgreSQL 768 MB), sin cuota fija de CPU: Node y Go dimensionan sus hilos por los núcleos del
host y una cuota los estrangula. vitest usa hilos y 10 s por prueba (`web-test.sh`). El workspace se
monta siempre en `/workspace` dentro del check, así que la caché de Go sirve entre ramas y PR; las
pruebas de Go con base de datos se invalidan cuando cambian las migraciones o el testdata. Los módulos
de Go y pnpm viven en el volumen `nava-ci-cache`.

Las claves de Resend, Meta y Google **no** están en Jenkins: viven solo en el servidor como
secretos de Docker (sección 2). Jenkins guarda en `/srv/jenkins/secrets` únicamente lo suyo (token
de GitHub, secreto del webhook, su llave SSH hacia `deploy` y la clave de **navegador** de Google
Maps, pública por diseño y restringida por dominio en Google Cloud, que se compila en la imagen web).

**Despliegue automático (DEC-160).** Corre solo cuando el CI de un commit de `main` termina en verde,
y despliega exactamente ese SHA. No hay aprobación manual previa: los controles son el PR revisado,
el CI, la simulación de las migraciones, el respaldo verificado previo y las pruebas de humo; si falla
cualquiera, no se despliega la aplicación. Si llegan dos commits seguidos, solo se despliega el más
nuevo. **Interruptor:** desactivar el job (*Nava Agenda → Deploy → Disable Project*) apaga el disparo
automático; *Enable* lo reactiva. Sin registro de imágenes: Jenkins construye en el mismo Docker que
ejecuta la pila y conserva los nombres `ghcr.io/bcaceres19/nava-agenda-*`.

## 6. Servicios externos que hay que apuntar al dominio

| Servicio | Qué configurar |
| --- | --- |
| Google Cloud, clave de navegador | Añadir `https://agenda.nava.wtf/*` a las referencias HTTP permitidas (`https://nava.wtf/*` mientras dure la transición) |
| Google Cloud, cliente OAuth de Calendar | Origen `https://agenda.nava.wtf` y URI de redirección `https://agenda.nava.wtf/panel/negocio/google-calendar/callback` (y la futura `…/panel/negocio/google-calendar/callback`, #662); las mismas cuatro variables `GOOGLE_CALENDAR_*` en `app.env` |
| Meta, webhook de WhatsApp | URL `https://agenda.nava.wtf/api/v1/public/webhooks/meta/whatsapp` y el token de verificación de `app.env` |
| Resend | Dominio `nava.wtf` verificado (sección 4) |

## 7. Operación

```bash
ssh nava-deploy
cd /srv/nava-agenda/current/deploy
C="docker compose --env-file /srv/nava-agenda/env/stack.env -f compose.yaml"
export IMAGE_TAG=$(cat /srv/nava-agenda/current-tag) DB_IMAGE_TAG=$(cat /srv/nava-agenda/current-db-tag)

$C ps                               # estado y salud
$C logs -f --tail=100 api           # logs (rotan solos: 5 × 20 MB por contenedor)
docker stats --no-stream            # consumo real frente a los límites
tail /srv/nava-agenda/deploy.log       # historial de despliegues (versión, actor, resultado)
```

**Desplegar**: ocurre solo tras cada commit de `main` con el CI en verde. A mano (reintento o SHA
anterior): Jenkins → *Nava Agenda* → *Deploy* → *Build with Parameters* (`SHA` vacío = último commit de
`main`; o un SHA). Verifica que el CI de Jenkins del commit esté en verde (un commit anterior a la migración del
2026-11-16 ya no se acepta: sus resultados de GitHub Actions se borraron), construye las imágenes que falten en el
Docker del servidor y entonces: respaldo previo verificado → migraciones con `agenda_migrator` (en dos fases: los roles `barberia_*` pasan a `agenda_*` tras `20261121090000`, DEC-183) →
arranque → pruebas de humo. **Si la migración falla, la aplicación en ejecución no se toca.**

**Revertir la aplicación** (roll-forward es lo normal; esto solo es seguro si el esquema actual es
compatible con la versión anterior, ver `migraciones-atlas.md` §9):
```bash
bash /srv/nava-agenda/releases/$(cat /srv/nava-agenda/previous-tag)/deploy/scripts/deploy.sh \
     $(cat /srv/nava-agenda/previous-tag) --db-tag $(cat /srv/nava-agenda/current-db-tag) --no-migrate
```
(las imágenes se conservan 7 días en el servidor; para una versión más vieja, lanza *Deploy* con
ese SHA: reconstruye sus imágenes desde el commit).

### Respaldos

- **Diario** a las 03:00 UTC con `pg_dump` (formato custom), más el definición de roles. Cada
  respaldo se verifica (`pg_restore --list`, tamaño mínimo, SHA-256) antes de darlo por bueno.
- **Retención** 30 días, sin bajar nunca de 7 respaldos. Carpeta: `/srv/nava-agenda/backups`.
- **Prueba de restauración** cada domingo: restaura el último respaldo en una instancia efímera
  y comprueba tablas, historial de migraciones y políticas RLS. También manual:
  `docker exec nava-backup-1 restore-test.sh`. Un respaldo manual se hace con
  `docker exec nava-backup-1 with-secrets backup.sh` (`with-secrets` carga la contraseña de
  `/run/secrets`; sin él, `pg_dump` no tiene credenciales).
- **Salud**: el contenedor `backup` queda `unhealthy` si el último respaldo exitoso tiene más de 28 h.
- **Copia externa**: `stack-despliegue-operacion.md` §5 exige almacenamiento separado del servidor.
  Rellena `BACKUP_RCLONE_REMOTE` y las variables `RCLONE_CONFIG_*` en `backup.env` (Backblaze B2,
  S3, Google Drive u otro soporte de rclone) y cada respaldo se copiará allí. **Mientras esté vacío,
  los respaldos viven en el mismo servidor que la base**: un fallo del disco los perdería.

**Restaurar** (destructivo; hace antes un respaldo de seguridad y detiene API y worker):
```bash
CONFIRM_RESTORE=yes bash /srv/nava-agenda/current/deploy/scripts/restore.sh \
    /srv/nava-agenda/backups/nava-AAAAMMDDTHHMMSSZ.dump
```
Sobre un servidor nuevo: copia el respaldo, ejecuta una vez `deploy.sh` (crea `db` con sus roles)
y luego `restore.sh`.

## 8. Pendientes y decisiones abiertas

- **Versión mayor de PostgreSQL**: producción usa la 16 (`POSTGRES_VERSION` en
  [`db.Dockerfile`](docker/db.Dockerfile)); el piso decidido es la 14 y el CI aún prueba la 14,
  que termina su soporte el 2026-11-12. Las 41 migraciones se aplicaron sin cambios en la 16 y
  el API arrancó contra ella, pero la suite completa corre solo sobre la 14. Falta decidir
  formalmente la versión (`DEC-*`) y llevar el CI a esa versión.
- **Cambiar de versión mayor de PostgreSQL** exige un volcado y restauración; no se hace
  cambiando solo la etiqueta.
- **Monitoreo y alertas**: no incluidos. El contenedor `backup` y los `healthcheck` de Docker
  son la única señal; falta un monitor externo sobre `https://agenda.nava.wtf/health` (`nava.wtf/health` es la landing y responde 200 con su HTML, #691).
- **CSP**: Caddy aplica HSTS, `nosniff`, `X-Frame-Options` y `Permissions-Policy`, pero no una
  Content-Security-Policy estricta (la app carga scripts de Google Maps); requiere su propio
  trabajo y pruebas.
- **Migraciones destructivas sin aprobación**: con el despliegue automático (DEC-160) una migración
  entra a producción en cuanto se integra en `main`. Hasta que exista un entorno con aprobadores, la
  revisión del SQL en el PR es el único control humano; evita mezclar DDL destructivo con otros cambios.
