---
prompt_id: "PROMPT-OPS-ODIN-EVALUAR-CABIDA-VPS-v1"
version: "1.0"
kind: "ops"
status: "draft"
target_agents:
  - "any"
repository: "externo — repositorio propio del asistente de IA de Odin, fuera de bcaceres19/barberia"
base_branch: null
primary_hu: null
related_hu: []
issue: "pending"
issue_url: null
suggested_issue_title: "ops(odin): evaluar en solo lectura si Odin cabe en el VPS de NAVA"
branch: null
pr: null
pr_url: null
depends_on: []
rules: []
decisions:
  - "DEC-158"
  - "DEC-159"
  - "DEC-160"
acceptance_criteria: []
source_docs:
  - "AGENTS.md"
  - "deploy/README.md"
created_at: "2026-11-06"
updated_at: "2026-11-06"
supersedes: null
superseded_by: null
---

# Evaluar en solo lectura si Odin cabe en el VPS de NAVA

## Instrucción para el agente

Este prompt no modifica el repositorio `bcaceres19/barberia` ni el servidor. Está dirigido al agente de Odin, que lo ejecuta **desde su propio repositorio** y en la máquina del propietario. Su entrega es un **informe con veredicto**, no un despliegue. Por eso queda `status: draft` e `issue: pending` de forma permanente, como el resto de handoffs a Odin; el archivo se versiona en `barberia` solo para que la conversación que lo originó no se pierda (issue #553).

## Objetivo

Saber, con mediciones reales y no con suposiciones, si Odin (runtime y su base de datos) puede convivir en el VPS de producción donde ya corre NAVA, sin quitarle recursos ni exponer nada. El resultado es uno de tres veredictos: **cabe**, **cabe con ajustes** (se enumeran) o **no cabe** (se explica qué falta).

## Preflight obligatorio

1. Comprueba que tu árbol esté limpio y no sobrescribas cambios ajenos.
2. Lee `AGENTS.md` de tu repositorio y los documentos de infraestructura de Odin (`docs/05-infraestructura/`), `compose.yaml` y `Dockerfile`.
3. Comprueba que no estás ejecutando nada fuera de este alcance: este prompt **no autoriza** a escribir en el servidor, construir imágenes allí ni descargar modelos.
4. Si algo de lo que sigue contradice tus propias reglas, prevalecen las más restrictivas; registra la duda en el informe antes de actuar.

## Cómo conectarte al VPS (solo lectura)

- Comando: `ssh barberia-vps <comando>`. El alias, el usuario y la llave **ya están configurados** en `~/.ssh/config` del propietario en esta máquina. No hace falta ni se permite pedir contraseñas, llaves o tokens.
- No leas, copies, imprimas ni muevas nada de `~/.ssh` (ni la llave privada ni `known_hosts` con fines distintos a la conexión). No uses el usuario root (el acceso root está deshabilitado) ni otros alias o cuentas del servidor.
- Si el sistema de permisos te niega la conexión o un comando, **detente y repórtalo**: no busques otra vía ni reformules el comando para esquivar la negativa. El propietario decide si lo autoriza.
- Cada conexión es una operación contra producción: agrupa las consultas en pocas llamadas y no repitas las que ya tengas.

### Comandos permitidos (lista cerrada)

```text
uname -m ; uname -r ; cat /etc/os-release
nproc ; lscpu                      # modelo, núcleos y flags (¿avx2?)
free -m ; cat /proc/meminfo        # memoria y swap
df -h ; lsblk
uptime ; cat /proc/loadavg
docker --version ; docker compose version
sudo -n docker ps --format ...     # solo lectura: nombres, imagen, estado
sudo -n docker stats --no-stream   # uso real de memoria y CPU por contenedor
sudo -n docker system df           # espacio de imágenes y volúmenes
sudo -n ss -ltn                    # puertos que escuchan en el host
getenforce ; sudo -n firewall-cmd --list-all
```

### Prohibido

- Cualquier escritura, instalación o cambio: `docker run/pull/build/rm/exec/compose up/down`, `systemctl`, `dnf`, `firewall-cmd` con opciones que modifiquen, editar o crear archivos.
- Leer `/srv/barberia/secrets/`, `/srv/barberia/env/`, variables de entorno de los contenedores de NAVA, su base de datos o sus logs con datos de clientes.
- Pruebas de carga, benchmarks o descargas de modelos en el servidor: un benchmark es carga sobre producción.
- Publicar puertos, abrir el firewall o tocar el Caddy de NAVA.

## Datos de referencia (2026-11-06; **verifícalos, no los asumas**)

- VPS Fedora con Docker y Compose, SELinux en modo Enforcing, firewalld y fail2ban activos; aprox. 4 vCPU, 7,6 GB de RAM y 75 GB de disco, arquitectura x86_64.
- NAVA corre como un proyecto Compose propio con cinco contenedores (web, api, worker, db y backup); solo su Caddy publica los puertos 80 y 443. A la fecha usaba unos 100 MB de memoria entre todos.
- El runtime de despliegue de NAVA está documentado en `deploy/README.md` de `barberia` (léelo solo para entender la convivencia; no lo ejecutes).

## Qué debes calcular de Odin (desde tu repositorio)

1. **Memoria en el pico**: suma de los `mem_limit` de los servicios que se desplegarían (runtime y base de datos) más el sistema operativo y NAVA. Considera que los modelos de intención (p. ej. `bge-m3`, `e5-base`, MiniLM) se cargan en RAM.
2. **Disco**: imagen del runtime, imagen de la base (pgvector), volúmenes de datos y de caché de modelos, y crecimiento previsible de logs y respaldos. Excluye lo que no viaja en la imagen (`eval-runs`, `cases`, `backups`, `work-cierre-*`, entrenamientos y evaluaciones).
3. **CPU**: hilos de embeddings, concurrencia configurada, y si los modelos requieren instrucciones de CPU concretas (comprueba los flags del servidor contra lo que tu pila necesita).
4. **Compatibilidad**: arquitectura de las imágenes base, versión mínima de Docker/Compose, SELinux (volúmenes con nombre frente a montajes de carpeta, que exigirían la etiqueta `:z`), conflictos de puertos con lo que ya escucha en el host y nombre del proyecto Compose (debe ser distinto del de NAVA para aislar redes y volúmenes).
5. **Aislamiento**: Odin no debe compartir base de datos, red ni volúmenes con NAVA, y debe leer NAVA solo por su API pública (nada de acceso directo a su base).

## Regla de decisión

- **Cabe**: la memoria pico de Odin deja libre al menos 1,5 GB (o el 20 %, lo que sea mayor) para NAVA y el sistema; el disco libre es al menos el doble de lo que Odin necesita; la CPU y la arquitectura son compatibles; no hay choque de puertos.
- **Cabe con ajustes**: lo anterior se cumple solo reduciendo algo concreto (un límite de memoria, un encoder, la concurrencia, un swap). Enumera cada ajuste y su costo en calidad o latencia.
- **No cabe**: alguna condición dura falla (arquitectura, instrucciones de CPU, memoria insuficiente incluso con ajustes). Di cuál y qué tamaño de servidor haría falta.

## Alcance incluido

- Las consultas de solo lectura de la lista cerrada, el cálculo de necesidades de Odin y el informe con veredicto.
- Si cabe, una **propuesta** (sin ejecutar) del despliegue mínimo: solo el runtime y su base, sin Gradio expuesto, sin entrenamiento ni evaluaciones, y con el tope de gasto diario del proveedor del modelo.

## Fuera de alcance

- Desplegar, construir o iniciar cualquier cosa en el VPS, y descargar modelos allí.
- La entrada HTTP o de WhatsApp de Odin, la verificación de negocio de Meta y la clave del proveedor del modelo.
- Cualquier cambio en `barberia` o en su despliegue.

## Estado existente que debe conservarse

- Todo lo que corre en el VPS: NAVA debe seguir exactamente como está al terminar (comprueba, antes y después, que `docker ps` muestra lo mismo).

## Trabajo requerido

1. Lee en tu repositorio `compose.yaml`, `Dockerfile` y `docs/05-infraestructura/` y calcula la tabla de necesidades (memoria, disco, CPU, puertos).
2. Conéctate con `ssh barberia-vps` y ejecuta solo los comandos permitidos, agrupados.
3. Compara necesidades con lo disponible y aplica la regla de decisión.
4. Escribe el informe.

## Pruebas y evidencia

Entrega una tabla y resume (sin pegar salidas completas ni datos sensibles) la evidencia de cada fila:

`Recurso | Odin necesita | VPS libre hoy | Resultado | Comando o fuente`

Incluye además: veredicto, ajustes si los hay, riesgos para NAVA y las preguntas abiertas para el propietario. Opcionalmente, guarda el informe en tu repositorio (p. ej. `docs/05-infraestructura/viabilidad-vps-nava.md`) **sin IP, rutas de llaves, secretos ni datos de clientes**.

## Documentación y trazabilidad

- Este archivo se referencia desde el índice del catálogo de prompts de `barberia`. No cambia la matriz ni el código de `barberia`.

## Verificación final

```text
N/A en barberia. Antes de entregar, comprueba que `sudo -n docker ps` muestra los mismos contenedores que al empezar y que no escribiste nada en el servidor.
```

## Git y PR

- No aplica en `barberia`: este prompt no abre rama ni PR allí.
- Si guardas el informe en tu repositorio, sigue sus convenciones. No incluyas secretos, IP ni datos personales.
