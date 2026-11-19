<img src="apps/web/public/favicon.svg" alt="" width="48" height="48">

# Nava Agenda

Agenda de citas web para negocios de servicios (barberías, salones, consultorios y estudios). El negocio publica sus servicios y profesionales y recibe reservas en línea sin cruces de horario. En producción en [agenda.nava.wtf](https://agenda.nava.wtf).

## Qué hace

- **Reserva pública:** el cliente elige servicio, profesional y hora libre desde el enlace público del negocio. También admite servicios a domicilio.
- **Agenda del equipo:** horarios, bloqueos y disponibilidad por profesional, con un panel para crear, mover y cancelar turnos sin solapes.
- **Clientes al tanto:** acceden a su turno con un enlace o un código por WhatsApp, reciben un correo si el profesional lo cancela o reprograma, y dejan una reseña cuando terminó.
- **Google Calendar:** cada profesional puede conectar su calendario y ver allí sus citas.
- **Varios negocios, datos separados:** cada negocio solo ve lo suyo (RLS en PostgreSQL) y queda auditoría de los cambios.
- **Privacidad:** los clientes sin actividad en 24 meses se anonimizan solos.

## Cómo encaja en Nava

Es uno de los productos de la familia NAVA, junto a Nava Pedidos (pedidos por WhatsApp), Nava Nexos (bots de WhatsApp por negocio) y la landing [nava.wtf](https://nava.wtf). Comparten la misma VPS. El Caddy de este repo (`deploy/caddy`) publica los dominios de todos.

## Stack

- **Backend:** Go, con dos procesos (`api` y `worker`) y el contrato HTTP en OpenAPI (`api/openapi`).
- **Frontend:** Vue 3, TypeScript y Vite.
- **Base de datos:** PostgreSQL 16 con RLS y migraciones Atlas.
- **Infraestructura:** contenedores Docker Compose en una VPS, detrás de Caddy con HTTPS.

## Desarrollo local

Requiere Docker, Go, Node.js con pnpm y Atlas.

```bash
cd database && atlas migrate apply --env local    # PostgreSQL con el esquema al día
cd apps/api && go run ./cmd/api                   # API en :8080
cd apps/web && pnpm install && pnpm dev           # Frontend en :5173
```

Las pruebas son las mismas del CI: `tools/ci/run.sh go --postgres`, `tools/ci/run.sh database --postgres`, `tools/ci/run.sh web-test` y `tools/ci/run.sh web-static`. Las variables, los roles y el arranque completo están en el skill [`local-app-startup`](.agents/skills/local-app-startup/SKILL.md). Para contribuir, sigue [`AGENTS.md`](AGENTS.md).

## Despliegue

- **Producción:** [agenda.nava.wtf](https://agenda.nava.wtf).
- **Jenkins:** `agenda/ci` revisa cada PR y cada push a `main`. Cuando pasa en `main`, lanza `agenda/deploy` con ese SHA, que migra la base, recrea los contenedores, corre las pruebas de humo y verifica el HTTPS público.

## Documentación

Las decisiones, las reglas, las historias, la arquitectura y los runbooks están en la bóveda de Nava: [nava-docs/agenda](https://github.com/nava-project/nava-docs/tree/main/agenda).
