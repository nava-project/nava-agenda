---
prompt_id: "PROMPT-OPS-ODIN-ENLACE-MI-TURNO-v1"
version: "1.0"
kind: "ops"
status: "blocked"
target_agents:
  - "claude"
  - "codex"
repository: "externo — bcaceres19/odin (no modifica bcaceres19/barberia)"
base_branch: "main"
primary_hu: null
related_hu:
  - "HU-098"
  - "HU-099"
  - "HU-104"
  - "HU-105"
issue: "bcaceres19/odin#7"
issue_url: "https://github.com/bcaceres19/odin/issues/7"
suggested_issue_title: null
branch: null
pr: null
pr_url: null
depends_on:
  - "HU-105 integrada en main de bcaceres19/barberia y desplegada (issue bcaceres19/barberia#637)"
rules:
  - "RN-DAT-01"
  - "RN-DAT-02"
  - "RN-TEN-01"
decisions:
  - "DEC-089"
  - "DEC-178"
acceptance_criteria: []
source_docs:
  - "bcaceres19/barberia: docs/02-requisitos/historias-usuario.md (HU-104, HU-105)"
  - "bcaceres19/barberia: docs/00-control/registro-decisiones.md (DEC-089, DEC-178)"
  - "bcaceres19/odin: AGENTS.md y la skill .claude/skills/odin-orientacion"
  - "bcaceres19/odin: src/odin/application/booking_link.py"
  - "bcaceres19/odin: src/odin/application/barber_rendering.py"
  - "bcaceres19/odin: src/odin/application/barber_intent.py"
  - "bcaceres19/odin: src/odin/application/eye_nava_runtime.py"
  - "bcaceres19/odin: src/odin/application/eye_nava_agent.py"
  - "bcaceres19/odin: src/odin/application/grounding.py"
  - "bcaceres19/odin: src/odin/tools/barber_toolbox.py"
created_at: "2026-11-17"
updated_at: "2026-11-17"
supersedes: null
superseded_by: null
---

# Odin da el enlace para cambiar la hora del turno

## Instrucción para el agente

Trabajas en el repositorio **bcaceres19/odin**, no en `barberia`. Antes de tocar nada, lee `AGENTS.md` y la skill `odin-orientacion` de Odin; sus reglas prevalecen sobre este prompt.

El issue es [bcaceres19/odin#7](https://github.com/bcaceres19/odin/issues/7). Este prompt está `blocked` y pasa a `ready` cuando `HU-105` esté integrada en `main` de `barberia` y desplegada, es decir, cuando la ruta `/reservar/<slug>/mi-turno` exista en producción. Si al empezar no se cumple, detente e informa. No publiques un enlace que todavía lleva a una página inexistente.

## Problema

EyeNava, el asistente de WhatsApp de la barbería, responde a «necesito cambiar mi cita» o «quiero cancelar mi turno» por dos caminos:

- **Regla de seguridad.** `safety_intent` (`barber_intent.py`, patrón `_CANCEL_ORDER`) clasifica el mensaje como `link`, y `_answer` (`eye_nava_runtime.py`) devuelve `render_link(...)`:
  > Yo solo informo: no agendo ni cancelo citas, eso lo haces tú directamente en NAVA.
  > Reserva aquí: `https://…/reservar/<slug>`
- **Modo agente.** La instrucción de `eye_nava_agent.py` dice: «Si piden cambiar o cancelar una cita, di que tú solo informas y que lo pregunte a la barbería; no le expliques cómo hacerlo».

En ambos casos el cliente recibe un enlace de **reservar**, que no le sirve para mover ni cancelar su turno.

## Contexto de NAVA (no se cambia aquí)

- **El enlace personal de «Mi turno»** (`/mi-turno/<token>`) solo llega en el correo de confirmación. NAVA guarda únicamente el hash del token (`DEC-089`). Odin **no tiene ni debe pedir** ese token: cualquiera que escriba por WhatsApp podría solicitarlo.
- **`HU-105`** añade una página fija por barbería, `/reservar/<slug>/mi-turno`. El cliente escribe su correo o teléfono, recibe un código de 6 dígitos y entra a cambiar la hora de su turno (`HU-104`). La página no revela si un contacto tiene turnos (`CA-105-01`) y no lleva datos de nadie en la URL. Por eso se puede publicar por WhatsApp sin riesgo.
- **Política `DEC-178`**:
  - solo cambian la fecha y la hora (mismo servicio y profesional);
  - mismo plazo que la cancelación;
  - máximo 2 cambios del cliente por turno.

  Odin **no recita ni interpreta** estas reglas por su cuenta: si las cita, las toma de `consultar_politicas` o del texto que NAVA publique.

## Qué hacer

1. **Comprueba qué permite `HU-105` ya integrada.** Lee su sección en `barberia` y abre la página desplegada.
   - Si desde el acceso con código solo se puede **cambiar la hora**, el enlace se ofrece solo para eso. A quien quiera **cancelar** se le sigue diciendo que lo pida a la barbería, sin enlace nuevo: no se promete una función que no existe.
   - Si también se puede **cancelar**, el enlace cubre ambos casos.

   Anota en el PR qué encontraste.

2. **Plantilla del enlace.** Añade al lado de `BookingLink`, en su propio módulo (regla de Odin: cada clase importante en su módulo), una clase como `ManageTurnLink`:
   - construye `f"{booking_base_url}/reservar/{slug}/mi-turno"` desde el `ShopProfile`, igual que `BookingLink`;
   - expone la herramienta en `BarberToolbox` (por ejemplo `build_manage_turn_link`), registrada con `_use` como las demás.

   El modelo **nunca** escribe la URL; sale siempre de la plantilla (I3).

3. **Intención propia.** Separa en `barber_intent.py` la orden de **cambiar la hora** («cambiar/mover/reprogramar mi cita o turno», «no puedo a esa hora, ¿la paso para…?») de la de reservar.
   - Devuelve una intención nueva (por ejemplo `manage`) en vez de `link`.
   - Cancelar sigue en `link` salvo que el paso 1 confirme que la página también cancela.
   - Mantén estas intenciones en la capa de reglas de seguridad: nunca las decide el clasificador aprendido.
   - Las preguntas de **política** («¿con cuánto tiempo puedo cancelar?», «¿cuántas veces puedo cambiar la hora?») siguen yendo a `policy`, no a `manage`.

4. **Respuesta fija.** Añade en `barber_rendering.py` un `render_manage_link(url)`, una plantilla sin modelo como `render_link`, con texto corto y cálido en el tono de Odin. Por ejemplo:
   > Yo no muevo citas, pero tú puedes hacerlo en un minuto: entra aquí, escribe el correo o el celular con el que reservaste y te llega un código.
   > `https://…/reservar/<slug>/mi-turno`

   Reglas del texto:
   - no afirmar que se canceló, movió ni confirmó nada;
   - no prometer que habrá cupo;
   - no inventar plazos ni límites;
   - no mencionar «NAVA» al cliente si el resto de respuestas al cliente no lo hace (revisa `NOT_MY_JOB` y decide con el mismo criterio que ya usan las respuestas del cliente; anótalo en el PR).

   En `eye_nava_runtime.py`, `_answer` despacha `manage` a esta plantilla. Como `link`, va por `by_safety`: sin apertura generada por el modelo que pueda leerse como «listo, ya lo hice».

5. **Modo agente.** Cambia la instrucción de `eye_nava_agent.py` («Si piden cambiar o cancelar una cita…») para que coincida con el comportamiento nuevo. Esas peticiones no deberían llegar al agente, porque la regla de seguridad responde antes. Si alguna llega, el agente no explica pasos ni da URLs: dice que ahí puede cambiarla y se usa la plantilla.

6. **Verificaciones de salida.** `grounding.py` (`_LINK_PROCEDURE`, `_STEP_ADVICE`), `rewrite_guard.py`, `voice_check.py` y `reply_rewrite_planner.py` vigilan frases como «cambiar … turno» o «ahí … cancelas».
   - Si alguno rechaza o reescribe la plantilla nueva, añade una excepción explícita **para esa plantilla**, igual que ya se hace con `NOT_MY_JOB`.
   - No aflojes las expresiones para todos: el modelo sigue sin poder describir procedimientos por su cuenta.

7. **Respeta el multi-inquilino.** El `slug` y la URL base salen del perfil del tenant autorizado (ADR 017/018), nunca del texto del mensaje. Un mensaje que nombra otra barbería sigue el camino actual (`_OTHER_SHOP_LINK`, `_CROSS_TENANT`).

## Fuera de alcance

- Cualquier cambio en `bcaceres19/barberia` o en la API de NAVA.
- Pedir, leer o reenviar el token de `/mi-turno/<token>`, códigos de verificación, correos o teléfonos de clientes.
- Que Odin cancele, mueva o confirme turnos (sigue siendo de solo lectura).
- Cambiar la respuesta de reservar (`render_link`) más allá de lo que exija separar las intenciones.

## Pruebas obligatorias

Ruff, mypy y pytest en verde, según `AGENTS.md` de Odin.

- **`tests/test_barber_intent.py`:**
  - frases de cambiar la hora → `manage`: «necesito reprogramar mi cita», «quiero mover mi turno del viernes», «¿me pueden cambiar la cita para más tarde?», «no puedo a esa hora, ¿la paso?»;
  - cancelar → `link` o `manage` según el paso 1;
  - preguntas de política → `policy`;
  - reservar → `link`.
- **`tests/test_eye_nava_runtime.py` y `tests/test_eye_nava_conversation.py`:**
  - la respuesta contiene exactamente la URL de la plantilla del tenant autorizado y ninguna otra URL;
  - no hay apertura del modelo;
  - un mensaje que nombra otra barbería no recibe su enlace.
- **Verificaciones de salida:** la plantilla pasa `grounding`, `rewrite_guard` y `voice_check`, y una respuesta del modelo que describa pasos («ahí eliges otra hora y cancelas») sigue siendo rechazada.
- **Conversaciones:** sigue la skill `odin-probar-conversaciones` con un lote corto de cambiar y cancelar. Ninguna expectativa existente se recalibra para que pase: si un caso viejo esperaba el enlace de reservar ante «cambiar mi cita», se actualiza explicando el motivo en el PR.

## Entrega

- Rama corta en `bcaceres19/odin` desde `main` actualizada, Conventional Commits y PR que cite bcaceres19/odin#7 y `bcaceres19/barberia#637`.
- En el PR:
  - qué permite la página de `HU-105` (paso 1);
  - el texto final de la plantilla;
  - ejemplos de conversación **sintéticos** (nada real; regla de Odin: no publicar conversaciones de usuarios).
- No desplegar sin autorización explícita del propietario.
- Al terminar, actualiza en `barberia` este prompt (`status`, `issue`, `branch`, `pr`) y su fila en `docs/10-backlog/prompts/README.md`.
