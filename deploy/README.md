# Despliegue de NAVA

Pila de producción en contenedores Docker sobre un VPS: proxy con HTTPS, API, worker,
PostgreSQL y respaldos. Todo se despliega desde GitHub Actions con el mismo commit que
superó el CI. Decisiones de base: [`stack-despliegue-operacion.md`](../docs/04-arquitectura/stack-despliegue-operacion.md)
y [`migraciones-atlas.md`](../docs/05-backend/migraciones-atlas.md).

## 1. Arquitectura

```text
Internet ──443/80──▶ web (Caddy: HTTPS, SPA, /api → api)
                       │  red "app" (interna)
                       ▼
                      api ──────────┐
                                    │ red "data" (interna, sin salida)
                     worker ────────┼──▶ db (PostgreSQL, TLS + SCRAM)
                     backup ────────┘        ▲
                                             │ pg_dump diario → /srv/barberia/backups
                     migrate (bajo demanda) ─┘

api y worker salen a Internet (Resend, Meta, Google) por la red "egress".
```

| Servicio | Imagen | CPU | Memoria | Función |
| --- | --- | --- | --- | --- |
| `web` | `barberia-web` | 0,5 | 256 MB | Caddy: HTTPS automático, SPA de Vue, proxy `/api/*` |
| `api` | `barberia-backend` | 1,0 | 512 MB | API HTTP (`GOMEMLIMIT` 400 MiB) |
| `worker` | `barberia-backend` | 0,5 | 256 MB | Recordatorios y purgas |
| `db` | `barberia-db` | 1,5 | 1,5 GB | PostgreSQL con TLS obligatorio |
| `backup` | `barberia-db` | 0,5 | 512 MB | Respaldo diario, retención y prueba semanal |
| `migrate` | `arigaio/atlas` | 1,0 | 256 MB | Migraciones (solo durante el despliegue) |

Los límites suman ~3,1 GB de los 7,6 GB del VPS. El consumo real en reposo es una fracción
(API ~25 MB, base ~50 MB). Se ajustan en [`compose.yaml`](compose.yaml).

Seguridad de los contenedores: sistema de archivos de solo lectura, `cap_drop: ALL`,
`no-new-privileges` y usuarios sin privilegios. **Solo `web` publica puertos (80 y 443).**
Docker salta el firewall del servidor para los puertos que publica, por eso la base y el
API nunca se publican. `db` y `backup` viven en una red interna sin salida a Internet.

## 2. Variables de entorno (`env_file`)

Un archivo por servicio en `/srv/barberia/env/` (modo 600, fuera del repositorio). Docker
Compose los carga con `env_file` en formato `raw`: el valor es literal, sin comillas ni
interpolación de `$`.

| Archivo | Lo usa | Contenido |
| --- | --- | --- |
| `stack.env` | compose | `DOMAIN`, `ACME_EMAIL`, registro de imágenes, puertos |
| `db.env` | `db` | superusuario y contraseñas de los roles (`DEC-040`) |
| `app.env` | `api`, `worker` | DSN, secreto HMAC, Resend, Meta, Google |
| `migrate.env` | `migrate` | URL del rol migrador y del administrador (bootstrap) |
| `backup.env` | `backup` | acceso de solo lectura, retención, copia externa |

[`scripts/env-init.sh`](scripts/env-init.sh) los genera con secretos aleatorios, **nunca
sobrescribe** un archivo existente y reutiliza las contraseñas ya generadas. Lo que solo tú
puedes dar (Resend, Meta, Google) queda vacío en `app.env`; `deploy.sh` se niega a desplegar
mientras falten los obligatorios (el API tampoco arranca sin ellos, `DEC-066`).

> **Respalda `/srv/barberia/env/` fuera del servidor** (gestor de contraseñas). El respaldo
> de la base no lo incluye y `APP_AUTH_HMAC_SECRET` no se puede reconstruir.

## 3. Puesta en marcha (una sola vez)

1. **DNS** del dominio: sección 4.
2. **GitHub**: entorno y secretos, sección 5.
3. **Entornos en el servidor** (genera los secretos aleatorios):
   ```bash
   tar czf - deploy | ssh barberia-deploy 'mkdir -p /srv/barberia/bootstrap && tar xzpf - -C /srv/barberia/bootstrap'
   ssh barberia-deploy 'bash /srv/barberia/bootstrap/deploy/scripts/env-init.sh --domain nava.wtf --acme-email TU_CORREO'
   ```
4. **Completa los proveedores** en `/srv/barberia/env/app.env` (`ssh barberia-deploy`, `nano`):
   `APP_RESEND_API_KEY`, `APP_META_WHATSAPP_PHONE_NUMBER_ID`, `APP_META_WHATSAPP_ACCESS_TOKEN`,
   `APP_META_WHATSAPP_TEMPLATE_NAME` y, si los usas, el webhook de Meta, `GOOGLE_MAPS_API_KEY`
   y Google Calendar.
5. **Despliega**: GitHub → Actions → *Deploy* → *Run workflow*.
   El primer despliegue crea los roles, aplica las migraciones y arranca todo.

## 4. DNS de `nava.wtf` en Hostinger

El dominio usa los nameservers de Hostinger (`*.dns-parking.com`), así que los registros se
editan en **hPanel → Dominios → nava.wtf → DNS / Servidores de nombres → Registros DNS**.

| Tipo | Nombre | Valor | TTL | Acción |
| --- | --- | --- | --- | --- |
| A | `@` | `158.69.232.180` | 300 | **Cambiar**: hoy apunta a `2.57.91.91` (página de aparcamiento de Hostinger) |
| CNAME | `www` | `nava.wtf` | 300 | Conservar (ya existe; Caddy redirige `www` al dominio sin `www`) |
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
- Comprueba: `dig +short nava.wtf` debe responder `158.69.232.180`. El certificado se emite
  solo cuando el DNS ya apunta al servidor; si aún no, `deploy.sh` avisa y Caddy reintenta.

## 5. GitHub

**Settings → Environments → New environment → `production`**
- *Required reviewers*: tú (aprobación manual antes de cada despliegue, exigida por
  `migraciones-atlas.md`).
- *Deployment branches*: solo `main`.
- *Secrets* del entorno:
  - `VPS_HOST`: `158.69.232.180`
  - `VPS_SSH_KEY`: contenido de la llave privada `~/.ssh/barberia_deploy_ed25519`
  - `VPS_KNOWN_HOSTS`: salida de `ssh-keyscan -t ed25519 158.69.232.180` (fija la identidad del
    servidor y evita ataques de intermediario)
- *Variables* del repositorio o del entorno:
  - `PUBLIC_URL`: `https://nava.wtf` (comprobación final del despliegue)
  - `VITE_GOOGLE_MAPS_BROWSER_KEY`: clave de **navegador** de Google Maps (es pública por diseño;
    se protege con la restricción por dominio en Google Cloud)

El repositorio es público: ningún secreto va en el código, y `VPS_SSH_KEY` solo en *Secrets*.

## 6. Servicios externos que hay que apuntar al dominio

| Servicio | Qué configurar |
| --- | --- |
| Google Cloud, clave de navegador | Añadir `https://nava.wtf/*` a las referencias HTTP permitidas |
| Google Cloud, cliente OAuth de Calendar | Origen `https://nava.wtf` y URI de redirección `https://nava.wtf/panel/barberia/google-calendar/callback`; las mismas cuatro variables `GOOGLE_CALENDAR_*` en `app.env` |
| Meta, webhook de WhatsApp | URL `https://nava.wtf/api/v1/public/webhooks/meta/whatsapp` y el token de verificación de `app.env` |
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

**Desplegar**: Actions → *Deploy* → *Run workflow* (vacío = último commit de `main`; o un SHA).
Verifica que el CI del commit esté en verde, construye y publica las imágenes en GHCR, espera tu
aprobación y entonces: respaldo previo verificado → migraciones con `barberia_migrator` → arranque →
pruebas de humo. **Si la migración falla, la aplicación en ejecución no se toca.**

**Revertir la aplicación** (roll-forward es lo normal; esto solo es seguro si el esquema actual es
compatible con la versión anterior, ver `migraciones-atlas.md` §9):
```bash
bash /srv/barberia/releases/$(cat /srv/barberia/previous-tag)/deploy/scripts/deploy.sh \
     $(cat /srv/barberia/previous-tag) --db-tag $(cat /srv/barberia/current-db-tag) --no-migrate
```
(las imágenes se conservan 7 días en el servidor; el registro guarda todas).

### Respaldos

- **Diario** a las 03:00 UTC con `pg_dump` (formato custom), más el definición de roles. Cada
  respaldo se verifica (`pg_restore --list`, tamaño mínimo, SHA-256) antes de darlo por bueno.
- **Retención** 30 días, sin bajar nunca de 7 respaldos. Carpeta: `/srv/barberia/backups`.
- **Prueba de restauración** cada domingo: restaura el último respaldo en una instancia efímera
  y comprueba tablas, historial de migraciones y políticas RLS. También manual:
  `docker exec nava-backup-1 restore-test.sh`.
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
- **Despliegue automático** tras cada merge: hoy es manual con aprobación. Puede añadirse un
  disparador `workflow_run` cuando el primer despliegue haya salido bien.
