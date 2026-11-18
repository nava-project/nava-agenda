# Despliegue de NAVA

Pila de producción en contenedores Docker sobre un VPS: proxy con HTTPS, API, worker,
PostgreSQL y respaldos. Todo se despliega desde el Jenkins de la propia VPS
([`jenkins/README.md`](jenkins/README.md), `DEC-177`) con el mismo commit que superó el CI. Decisiones de base: [`stack-despliegue-operacion.md`](../docs/04-arquitectura/stack-despliegue-operacion.md)
y [`migraciones-atlas.md`](../docs/05-backend/migraciones-atlas.md).

## 1. Arquitectura

```text
Internet ──443/80──▶ web (Caddy: HTTPS, SPA, /api → api)   agenda.nava.wtf (DEC-183)
                       │  red "app" (interna)
                       ▼
                      api ──────────┐
                                    │ red "data" (interna, sin salida)
                     worker ────────┼──▶ db (PostgreSQL, TLS + SCRAM)
                     backup ────────┘        ▲
                                             │ pg_dump diario → /srv/barberia/backups
                     migrate (bajo demanda) ─┘

api y worker salen a Internet (Resend, Meta, Google) por la red "egress".

Internet ──443──▶ web (Caddy) ── red "edge" (externa, compartida) ──▶ pedidos:8080
                  pedidos.nava.wtf                                      (pila aparte)
                  jenkins.nava.wtf ──────────────────────────────────▶ jenkins:8080
                                                                        (pila aparte, DEC-177)
```

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
| `web` | `barberia-web` | 0,5 | 256 MB | Caddy: HTTPS automático, SPA de Vue, proxy `/api/*` |
| `api` | `barberia-backend` | 1,0 | 512 MB | API HTTP (`GOMEMLIMIT` 400 MiB) |
| `worker` | `barberia-backend` | 0,5 | 256 MB | Recordatorios y purgas |
| `db` | `barberia-db` | 1,5 | 1,5 GB | PostgreSQL con TLS obligatorio |
| `backup` | `barberia-db` | 0,5 | 512 MB | Respaldo diario, retención y prueba semanal |
| `migrate` | `barberia-db` (Atlas 1.3.0 incluido) | 1,0 | 256 MB | Migraciones (solo durante el despliegue) |

Los límites suman ~3,1 GB de los 7,6 GB del VPS. El consumo real en reposo es una fracción
(API ~25 MB, base ~50 MB). Se ajustan en [`compose.yaml`](compose.yaml).

Seguridad de los contenedores: sistema de archivos de solo lectura, `cap_drop: ALL`,
`no-new-privileges` y usuarios sin privilegios. **Solo `web` publica puertos (80 y 443).**
Docker salta el firewall del servidor para los puertos que publica, por eso la base y el
API nunca se publican. `db` y `backup` viven en una red interna sin salida a Internet.

## 2. Configuración y secretos

Configuración y secretos van **separados** y los dos viven en el servidor, fuera del repositorio.

**Configuración** (sin secretos) en `/srv/barberia/env/`, cargada con `env_file` en formato `raw`
(valor literal, sin comillas ni interpolación de `$`):

| Archivo | Lo usa | Contenido |
| --- | --- | --- |
| `stack.env` | compose | `DOMAIN`, `ACME_EMAIL`, registro de imágenes, rutas, puertos |
| `db.env` | `db` | usuario y nombre de la base |
| `app.env` | `api`, `worker` | entorno, proxies de confianza, datos no sensibles de proveedores |
| `backup.env` | `backup` | host, retención, hora, remoto de rclone |

**Secretos** como archivos de secreto de Docker, uno por secreto, en
`/srv/barberia/secrets/<servicio>/<NOMBRE>` (carpetas 700, archivos 600, dueño `deploy`):

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

> **Respalda `/srv/barberia/secrets/` fuera del servidor** (gestor de contraseñas). El respaldo de
> la base no lo incluye y `APP_AUTH_HMAC_SECRET` no se puede reconstruir. Para cambiar el valor de
> un secreto: `secret-set.sh` y luego `docker compose ... up -d --force-recreate api worker`.
> Rotar las contraseñas de PostgreSQL exige además `ALTER ROLE` dentro de la base.

## 3. Puesta en marcha (una sola vez)

1. **DNS** del dominio: sección 4.
2. **Jenkins** en la VPS: sección 5 y [`jenkins/README.md`](jenkins/README.md).
3. **Configuración y secretos en el servidor** (genera los valores aleatorios):
   ```bash
   tar czf - deploy | ssh barberia-deploy 'mkdir -p /srv/barberia/bootstrap && tar xzpf - -C /srv/barberia/bootstrap'
   ssh barberia-deploy 'bash /srv/barberia/bootstrap/deploy/scripts/env-init.sh --domain nava.wtf --acme-email TU_CORREO'
   ```
4. **Completa los proveedores.** Los secretos se guardan sin eco y sin pasar por la línea de comandos:
   ```bash
   ssh -t barberia-deploy 'bash /srv/barberia/bootstrap/deploy/scripts/secret-set.sh app APP_RESEND_API_KEY'
   ssh -t barberia-deploy 'bash /srv/barberia/bootstrap/deploy/scripts/secret-set.sh app APP_META_WHATSAPP_ACCESS_TOKEN'
   ```
   (opcionales: `APP_META_WEBHOOK_VERIFY_TOKEN`, `APP_META_APP_SECRET`, `GOOGLE_MAPS_API_KEY`, los de
   Google Calendar y `APP_ODIN_SERVICE_TOKEN`, el secreto con el que Odin consulta los turnos por
   teléfono: `HU-106`, `DEC-179`; mínimo 32 caracteres, distinto de los de Meta; lo genera el
   propietario y es el mismo valor que configura en Odin; sin él esas rutas no existen). Los datos no sensibles (`APP_META_WHATSAPP_PHONE_NUMBER_ID`,
   `APP_META_WHATSAPP_TEMPLATE_NAME`) se escriben en `/srv/barberia/env/app.env`.
5. **Despliega**: no hace falta hacer nada; el primer commit que llegue a `main` con el CI en verde
   se despliega solo (o lánzalo a mano: Jenkins → *Barbería* → *Deploy* → *Build with Parameters*).
   El primer despliegue crea los roles, aplica las migraciones y arranca todo.

## 4. DNS de `nava.wtf` en Hostinger

El dominio usa los nameservers de Hostinger (`*.dns-parking.com`), así que los registros se
editan en **hPanel → Dominios → nava.wtf → DNS / Servidores de nombres → Registros DNS**.

| Tipo | Nombre | Valor | TTL | Acción |
| --- | --- | --- | --- | --- |
| A | `@` | `158.69.232.180` | 300 | **Cambiar**: hoy apunta a `2.57.91.91` (página de aparcamiento de Hostinger) |
| CNAME | `www` | `nava.wtf` | 300 | Conservar (ya existe; Caddy redirige `www` al dominio sin `www`) |
| A | `pedidos` | `158.69.232.180` | 300 | Ya existe: Nava · Pedidos, servido por este Caddy (`DEC-176`) |
| A | `jenkins` | `158.69.232.180` | 300 | Jenkins de la VPS, servido por este Caddy (`DEC-177`) |
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

El CI y los despliegues los hace el Jenkins de la VPS (`DEC-177`), en `https://jenkins.nava.wtf`;
la instalación, los secretos y la operación están en [`jenkins/README.md`](jenkins/README.md).
GitHub Actions quedó retirado y desactivado en el repositorio (#634): GitHub ya no guarda nada necesario
para desplegar ni hay registro de imágenes.

| Pipeline | Cuándo corre | Qué hace |
| --- | --- | --- |
| `barberia/ci` | cada PR contra `main` y cada commit de `main` | los checks de [`Jenkinsfile`](../Jenkinsfile) y el estado en el commit de GitHub; en `main`, si pasa, construye las imágenes y dispara `deploy` |
| `barberia/deploy` | lo dispara el CI de `main`; a mano con un SHA | worktree en el SHA, imágenes que falten, envío al servidor y `deploy.sh` como `deploy` |
| `vps/mantenimiento` | diario | contenedores de CI huérfanos y caché de construcción de más de 7 días |

Las claves de Resend, Meta y Google **no** están en Jenkins: viven solo en el servidor como
secretos de Docker (sección 2). Jenkins guarda en `/srv/jenkins/secrets` únicamente lo suyo (token
de GitHub, secreto del webhook, su llave SSH hacia `deploy` y la clave de **navegador** de Google
Maps, pública por diseño y restringida por dominio en Google Cloud, que se compila en la imagen web).

**Despliegue automático (DEC-160).** Corre solo cuando el CI de un commit de `main` termina en verde,
y despliega exactamente ese SHA. No hay aprobación manual previa: los controles son el PR revisado,
el CI, la simulación de las migraciones, el respaldo verificado previo y las pruebas de humo; si falla
cualquiera, no se despliega la aplicación. Si llegan dos commits seguidos, solo se despliega el más
nuevo. **Interruptor:** desactivar el job (*Barbería → Deploy → Disable Project*) apaga el disparo
automático; *Enable* lo reactiva. Sin registro de imágenes: Jenkins construye en el mismo Docker que
ejecuta la pila y conserva los nombres `ghcr.io/bcaceres19/barberia-*`.

## 6. Servicios externos que hay que apuntar al dominio

| Servicio | Qué configurar |
| --- | --- |
| Google Cloud, clave de navegador | Añadir `https://agenda.nava.wtf/*` a las referencias HTTP permitidas (`https://nava.wtf/*` mientras dure la transición) |
| Google Cloud, cliente OAuth de Calendar | Origen `https://agenda.nava.wtf` y URI de redirección `https://agenda.nava.wtf/panel/barberia/google-calendar/callback` (y la futura `…/panel/negocio/google-calendar/callback`, #662); las mismas cuatro variables `GOOGLE_CALENDAR_*` en `app.env` |
| Meta, webhook de WhatsApp | URL `https://agenda.nava.wtf/api/v1/public/webhooks/meta/whatsapp` y el token de verificación de `app.env` (`nava.wtf/api/*` sigue llegando al API durante la transición) |
| Resend | Dominio `nava.wtf` verificado (sección 4) |

## 7. Operación

```bash
ssh barberia-deploy
cd /srv/barberia/current/deploy
C="docker compose --env-file /srv/barberia/env/stack.env -f compose.yaml"
export IMAGE_TAG=$(cat /srv/barberia/current-tag) DB_IMAGE_TAG=$(cat /srv/barberia/current-db-tag)

$C ps                               # estado y salud
$C logs -f --tail=100 api           # logs (rotan solos: 5 × 20 MB por contenedor)
docker stats --no-stream            # consumo real frente a los límites
tail /srv/barberia/deploy.log       # historial de despliegues (versión, actor, resultado)
```

**Desplegar**: ocurre solo tras cada commit de `main` con el CI en verde. A mano (reintento o SHA
anterior): Jenkins → *Barbería* → *Deploy* → *Build with Parameters* (`SHA` vacío = último commit de
`main`; o un SHA). Verifica que el CI de Jenkins del commit esté en verde (un commit anterior a la migración del
2026-11-16 ya no se acepta: sus resultados de GitHub Actions se borraron), construye las imágenes que falten en el
Docker del servidor y entonces: respaldo previo verificado → migraciones con `agenda_migrator` (en dos fases: los roles `barberia_*` pasan a `agenda_*` tras `20261121090000`, DEC-183) →
arranque → pruebas de humo. **Si la migración falla, la aplicación en ejecución no se toca.**

**Revertir la aplicación** (roll-forward es lo normal; esto solo es seguro si el esquema actual es
compatible con la versión anterior, ver `migraciones-atlas.md` §9):
```bash
bash /srv/barberia/releases/$(cat /srv/barberia/previous-tag)/deploy/scripts/deploy.sh \
     $(cat /srv/barberia/previous-tag) --db-tag $(cat /srv/barberia/current-db-tag) --no-migrate
```
(las imágenes se conservan 7 días en el servidor; para una versión más vieja, lanza *Deploy* con
ese SHA: reconstruye sus imágenes desde el commit).

### Respaldos

- **Diario** a las 03:00 UTC con `pg_dump` (formato custom), más el definición de roles. Cada
  respaldo se verifica (`pg_restore --list`, tamaño mínimo, SHA-256) antes de darlo por bueno.
- **Retención** 30 días, sin bajar nunca de 7 respaldos. Carpeta: `/srv/barberia/backups`.
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
CONFIRM_RESTORE=yes bash /srv/barberia/current/deploy/scripts/restore.sh \
    /srv/barberia/backups/nava-AAAAMMDDTHHMMSSZ.dump
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
  son la única señal; falta un monitor externo sobre `https://nava.wtf/health`.
- **CSP**: Caddy aplica HSTS, `nosniff`, `X-Frame-Options` y `Permissions-Policy`, pero no una
  Content-Security-Policy estricta (la app carga scripts de Google Maps); requiere su propio
  trabajo y pruebas.
- **Migraciones destructivas sin aprobación**: con el despliegue automático (DEC-160) una migración
  entra a producción en cuanto se integra en `main`. Hasta que exista un entorno con aprobadores, la
  revisión del SQL en el PR es el único control humano; evita mezclar DDL destructivo con otros cambios.
