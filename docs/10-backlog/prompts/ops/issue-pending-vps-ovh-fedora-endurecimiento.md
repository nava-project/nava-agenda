---
prompt_id: "PROMPT-OPS-VPS-OVH-FEDORA-ENDURECIMIENTO-v1"
version: "1.0"
kind: "ops"
status: "draft"
target_agents:
  - "any"
repository: "bcaceres19/barberia"
base_branch: "main"
primary_hu: null
related_hu: []
issue: "pending"
issue_url: null
suggested_issue_title: "chore(ops): aprovisionar y endurecer el VPS Fedora de producción con Docker"
branch: null
pr: null
pr_url: null
depends_on: []
rules: []
decisions: ["DEC-023", "DEC-024", "DEC-031", "DEC-033", "DEC-034", "DEC-036", "DEC-037", "DEC-038"]
acceptance_criteria: []
source_docs:
  - "AGENTS.md"
  - "CLAUDE.md"
  - "docs/04-arquitectura/stack-despliegue-operacion.md"
  - "docs/03-desarrollo/flujo-git-github.md"
  - "docs/05-backend/migraciones-atlas.md"
created_at: "2026-11-06"
updated_at: "2026-11-06"
supersedes: null
superseded_by: null
---

# Aprovisionar y endurecer el VPS Fedora de producción con Docker

## Instrucción para el agente

Prepara el servidor descrito aquí, o verifica que ya cumple lo descrito, sin ampliar el alcance. No despliegues la aplicación: eso pertenece a otro prompt (ver «Fuera de alcance»). Trabaja de forma autónoma hasta producir la tabla de verificación final.

## Estado de ejecución

El 2026-11-06 el propietario y un agente de Claude Code aplicaron manualmente estos pasos al VPS actual, **sin issue ni PR previos**. Por eso el prompt permanece `draft`: antes de reutilizarlo en otro servidor, o de cerrar esa deuda de trazabilidad, hace falta un issue real con criterios verificables. El resultado verificado figura en «Línea base alcanzada».

## Objetivo

Un VPS nuevo queda con acceso administrativo solo por llave, superficie de red mínima, actualizaciones de seguridad automáticas, Docker Engine con Compose y un usuario `deploy` sin privilegios de administración, listo para recibir el despliegue de NAVA según `docs/04-arquitectura/stack-despliegue-operacion.md`.

## Preflight obligatorio

1. Árbol limpio; `main` actualizada por fast-forward.
2. Lee `AGENTS.md`, `CLAUDE.md` y cada archivo de `source_docs`.
3. Localiza el issue real; si el metadato sigue `pending`, solicita autorización o créalo y actualiza este archivo antes de tocar el repositorio.
4. Pide los datos del servidor al propietario: IP, usuario inicial y el sistema operativo entregado por el proveedor. No supongas el usuario: en imágenes de OVH el login de `root` suele estar deshabilitado y existe un usuario por distribución (`fedora`, `debian`, `ubuntu`, `almalinux`, `rocky`).
5. Confirma que la acción es sobre el servidor correcto: un `ssh`/`sudo` mal dirigido modifica un host ajeno.

## Reglas de seguridad para el agente

- **La contraseña nunca pasa por el chat.** Si el servidor aún no tiene llave, ábrela con un diálogo gráfico del sistema que solo el propietario ve:
  `SSH_ASKPASS=<script> SSH_ASKPASS_REQUIRE=force DISPLAY=:0 ssh-copy-id -i <llave>.pub <usuario>@<ip>`, donde `<script>` ejecuta `kdialog --password "<mensaje>"` (KDE) o `zenity --password`. No guardes ni imprimas lo escrito.
- Si el servidor responde «Your password has expired / Password change required but no TTY», el propietario debe cambiarla en una sesión interactiva (`! ssh <usuario>@<ip>`); el agente no puede hacerlo.
- No reintentes contraseñas rechazadas más de una vez: fail2ban o el proveedor pueden bloquear la IP. Diagnostica primero el usuario.
- Crea llaves nuevas dedicadas al servidor (`ssh-keygen -t ed25519`), no reutilices las de otros proyectos. Nunca copies una llave privada al servidor ni al repositorio.
- No cierres la sesión administrativa abierta hasta probar el acceso nuevo desde una conexión independiente.

## Alcance incluido

1. **Acceso por llave**
   - Llave de administración y llave distinta para despliegue; la pública va a `authorized_keys`, la privada permanece en la máquina del propietario.
   - Alias en `~/.ssh/config` (`Host barberia-vps`, `Host barberia-deploy`) con `IdentitiesOnly yes`. Las llaves de administración no llevan passphrase si el agente debe operar sin interacción; el propietario decide.
2. **Endurecimiento de SSH** en `/etc/ssh/sshd_config.d/00-hardening.conf`. El prefijo `00` es obligatorio: `sshd` usa el primer valor leído y `50-cloud-init.conf` fuerza `PasswordAuthentication yes`.
   ```text
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin no
   PubkeyAuthentication yes
   AuthenticationMethods publickey
   PermitEmptyPasswords no
   MaxAuthTries 3
   LoginGraceTime 30
   MaxStartups 10:30:60
   X11Forwarding no
   AllowAgentForwarding no
   ClientAliveInterval 300
   ClientAliveCountMax 2
   GSSAPIAuthentication no
   ```
   Valida con `sshd -t`, recarga y comprueba con `sshd -T` y una conexión nueva antes de cerrar la sesión abierta.
3. **Firewall** (`firewalld`): servicios `ssh`, `http`, `https` y puerto `443/udp` (HTTP/3). Añade `ssh` al firewall **antes** de activarlo. Retira `mdns`. Nota: `--set-default-zone` no se puede combinar con otras opciones de `firewall-cmd`.
4. **fail2ban** con jail `sshd`, `backend = systemd`, bloqueo de 1 h con incremento exponencial hasta 1 semana.
5. **Actualizaciones**: aplicar todas las pendientes, reiniciar para cargar el kernel nuevo y activar `dnf5-automatic.timer` con `upgrade_type = security`, `apply_updates = yes`, `reboot = never`. En Fedora con dnf5 el paquete es `dnf5-plugin-automatic` (no `dnf-automatic`).
6. **Kernel y red**: `/etc/sysctl.d/90-hardening.conf` (syncookies, sin redirects ni source routing, `log_martians`, `kptr_restrict=2`, `dmesg_restrict=1`, BPF sin privilegios deshabilitado, `fs.protected_*`, `vm.swappiness=10`). Mantén `net.ipv4.ip_forward` intacto: Docker lo necesita. Zona horaria UTC y `chronyd` activo.
7. **Docker Engine** desde el repositorio oficial (`dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo`; verifica antes que existe el repositorio de la versión de Fedora instalada) con `docker-compose-plugin` y `docker-buildx-plugin`. `/etc/docker/daemon.json`:
   ```json
   {
     "log-driver": "local",
     "log-opts": { "max-size": "20m", "max-file": "5" },
     "live-restore": true,
     "no-new-privileges": true,
     "selinux-enabled": true,
     "default-ulimits": { "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 } }
   }
   ```
   SELinux permanece en `Enforcing`; los montajes de carpetas del host necesitan la etiqueta `:z`.
8. **Usuario `deploy`**: sin sudo, contraseña bloqueada (`passwd -l`), grupo `docker`, solo su llave dedicada. Carpetas `/srv/barberia/{releases,caddy}` (modo 750) y `/srv/barberia/{env,backups}` (modo 700), propiedad de `deploy`.

## Fuera de alcance

- Dockerfiles, `compose`, Caddy, PostgreSQL, migraciones Atlas, frontend estático, flujo de despliegue en GitHub Actions y reversión: los cubre el issue [#535](https://github.com/bcaceres19/barberia/issues/535) (`DEC-158`, carpeta `deploy/`), no este prompt.
- Dominio y DNS (necesarios para el certificado HTTPS real).
- Respaldos externos y prueba de restauración exigidos por `docs/04-arquitectura/stack-despliegue-operacion.md` §5: se decide primero el almacenamiento.
- Cargar secretos de producción (Resend, Twilio, Google, etc.) en `/srv/barberia/env/`.
- Subir la llave privada de `deploy` a GitHub Actions: lo hace el propietario.

## Advertencias que deben quedar documentadas

- **Docker salta `firewalld`.** Un puerto publicado por un contenedor queda alcanzable aunque la zona no lo permita. PostgreSQL y el API no publican puertos al host; solo el proxy inverso publica 80/443.
- **El grupo `docker` equivale a root.** Quien posea la llave de `deploy` controla el servidor; vive únicamente en los secretos del repositorio.
- **Primer acceso:** la contraseña inicial puede venir caducada; la contraseña del usuario sigue existiendo aunque SSH la rechace (útil para la consola web del proveedor).

## Línea base alcanzada (2026-11-06)

Verificada tras el reinicio:

- Fedora Linux 44 Cloud, 4 vCPU, 7,6 GB RAM, 75 GB de disco, kernel 7.2.15.
- `sshd`, `firewalld`, `fail2ban`, `docker` y `chronyd` activos; SELinux `Enforcing`.
- `sshd -T`: `passwordauthentication no`, `permitrootlogin no`, `authenticationmethods publickey`.
- Firewall: `ssh http https dhcpv6-client` y `443/udp`.
- Puertos a la escucha desde fuera: solo 22 (los demás son resolución local de nombres).
- Docker 29.9.3, Compose v5.7.0, `hello-world` ejecutado.
- Actualizaciones de seguridad pendientes: 0.
- Acceso por llave sin interacción con ambos alias; la contraseña se rechaza por SSH.

## Pruebas y evidencia

Ejecuta y pega la salida en la entrega. No cuentan como cumplidas las comprobaciones que no se hayan corrido contra el servidor.

```text
ssh -o BatchMode=yes barberia-vps 'echo ok'
ssh -o BatchMode=yes barberia-deploy 'docker ps && ! sudo -n true'
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password -o BatchMode=yes <usuario>@<ip> true   # debe fallar
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|authenticationmethods|maxauthtries)'
sudo firewall-cmd --list-all
sudo ss -tlnH
sudo fail2ban-client status sshd
systemctl is-active sshd firewalld fail2ban docker chronyd && getenforce
docker info --format '{{.SecurityOptions}} {{.LoggingDriver}} {{.LiveRestoreEnabled}}'
systemctl list-timers dnf5-automatic.timer --no-pager
```

Tras cualquier reinicio, vuelve a ejecutar la lista: los servicios deben arrancar solos.

## Documentación y trazabilidad

- Si el procedimiento cambia, actualiza `docs/04-arquitectura/stack-despliegue-operacion.md` (sección 6, paso del piloto a VPS) con el procedimiento documentado de despliegue y reversión.
- Actualiza los metadatos de este archivo y el índice del catálogo con issue, rama, PR y estado reales.
- Ningún secreto, IP privada de gestión, contraseña, llave ni token entra al repositorio. Las IP y los hosts se referencian por alias.

## Verificación final

Entrega una tabla:

`Criterio | Estado | Prueba o evidencia`

No declares cumplido aquello que no esté probado.

## Git y PR

- Commit/PR: `chore(ops): aprovisionar y endurecer el VPS de producción`.
- Usa `Closes #<issue>` solo si se cubre el issue completo; de lo contrario, `Refs #<issue>`.
- No hagas push directo, force push ni merge de `main` fuera del flujo del proyecto.
