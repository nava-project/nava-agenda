---
titulo: "Guía de revisión de la app de Meta (NAVA y Nexos)"
version: "1.1"
estado: "Vigente; las pantallas de Meta cambian, verificar contra la documentación oficial"
responsable: "Propietario del proyecto"
ultima_actualizacion: "2026-11-11"
documentos_relacionados:
  - "00-control/registro-decisiones.md"
  - "04-arquitectura/stack-despliegue-operacion.md"
---

# Guía de revisión de la app de Meta (NAVA y Nexos)

Checklist para publicar la app «NAVA-BARBERIA» de Meta (WhatsApp Business Platform) a nivel comercial. **Nexos** es el nombre comercial del asistente Odin y **no tiene interfaz propia**: es un bot de WhatsApp cuya configuración hace el propietario. Las partes que son de Odin las ejecuta el propietario en su repositorio; aquí solo se enumeran para no perderlas. Decisiones relacionadas: `DEC-123`, `DEC-124`, `DEC-126`, `DEC-161`, `DEC-163`, `DEC-164`.

## 1. Estado de partida (2026-11-11)

Flujo del panel: «Registrarte como proveedor de tecnología independiente» (Casos de uso → Personalizar → WhatsApp → Tech Provider onboarding), 1 de 2 pasos completados.

| Requisito del panel de Meta | Estado |
| --- | --- |
| Caso de uso «Conectarte con los clientes a través de WhatsApp» | Hecho |
| Inicio de sesión con Facebook para empresas | Hecho |
| Requisitos de las pruebas | Hecho |
| Paso 1 · Verificación del negocio | Hecho (aprobado) |
| Paso 2a · Revisar la configuración de la app (privacidad, ícono, categoría) | Por comprobar (sección 3) |
| Paso 2b · Grabar los dos videos | **Pendiente** (sección 5) |
| Paso 2c · Enviar la documentación de la revisión | **Pendiente**; el panel muestra la tarjeta «En revisión» aunque la solicitud figuraba «No enviada»: aclararlo antes de editar |
| Publicar (la app figura «Sin publicar») | **Pendiente** |

Números de la cuenta: «Nava-Agent» (conectado, calidad alta) y «Odin-Agent» (pendiente, nombre en revisión; renombrar a **Nexos**).

## 2. Modelo de alta de números: proveedor de tecnología (`DEC-164`)

Como Nexos y NAVA se conectan a números de WhatsApp Business **de otros negocios**, la app va como **proveedor de tecnología** (Tech Provider) con **registro integrado (Embedded Signup)**. Lo leído en la documentación oficial de Meta («Become a Tech Provider» y «Embedded Signup», 2026-11-11):

- Permisos que exige el programa, ambos con **acceso avanzado**: `whatsapp_business_messaging` (enviar mensajes en nombre de los clientes) y `whatsapp_business_management` (acceder a sus cuentas de WhatsApp y de mensajería). No hay otros permisos obligatorios.
- `business_management` solo aparece para quien comparte línea de crédito como Solution Partner; los proveedores de tecnología usan tokens de negocio. No se solicita.
- `public_profile` no interviene. Si figura en la solicitud de revisión, **quitarlo** (papelera); pedir un permiso sin uso solo añade preguntas del revisor.
- Hasta tener el acceso avanzado en los dos permisos **no se pueden incorporar clientes**.
- Embedded Signup usa «Inicio de sesión con Facebook para empresas» y el SDK de JavaScript; las versiones v2 y v3 se retiraron el 2026-10-15, por lo que se implementa la **v4**. Se necesita una página que aloje el botón de registro (a decidir: NAVA o una página de Nexos).
- Al incorporar a cada cliente hay que suscribir la app a los webhooks de su cuenta de mensajería, y el cliente debe añadir un método de pago a su cuenta.
- Límite inicial: 10 clientes nuevos por 7 días; con verificación del negocio, revisión y verificación de acceso sube a 200.

**Sin verificar** (no se leyeron esas páginas): detalle de la documentación que pide la página de App Review para proveedores, verificación de acceso y guía de implementación de la v4.

## 3. Configuración básica de la app (panel de Meta)

| Campo | Valor |
| --- | --- |
| URL de la política de privacidad | `https://nava.wtf/privacidad` |
| URL de las condiciones del servicio | `https://nava.wtf/terminos` |
| Instrucciones de eliminación de datos | `https://nava.wtf/privacidad#eliminar-datos` |
| Dominio de la app | `nava.wtf` |
| Ícono 1024×1024 | `logo-nava.png` (ajustar el tamaño si Meta lo exige) |
| Correo de contacto | `contacto@nava.wtf` |
| Categoría | Negocios y páginas / Productividad |

La política de `#556` ya está en producción y abre con la sección de Nexos y «Eliminación de tus datos».

## 3.1. Nombres visibles de los números (`DEC-167`)

Meta rechazó «NAVA» y «Nexos» a secas. Sus normas (Normas sobre nombres visibles de la Plataforma de WhatsApp Business) piden: relación evidente con el nombre legal del negocio, marca coherente con fuentes externas (el sitio web), sin términos genéricos, sin «oficial» ni «verificado», sin referencias a Meta o a sus apps, sin lenguaje promocional y sin formato de URL o correo; si la marca no es obvia, el formato «de [negocio]» con la relación visible en el sitio; un nombre personal exige que la naturaleza del negocio sea clara en fuentes externas.

| Número | Nombre propuesto |
| --- | --- |
| Nava-Agent (`+57 310 8953493`) | `NAVA Agenda` o `NAVA Barbería` |
| Nexos | `Nexos de NAVA` |

`nava.wtf` ya declara la relación: la sección del asistente presenta a Nexos como el asistente de NAVA y el pie nombra al titular (persona natural). Verificar que el sitio del portafolio de negocios en Meta sea `nava.wtf` y que el nombre legal verificado coincida con el del pie. Si vuelven a rechazar, conservar el motivo exacto del mensaje de Meta y apelar con enlace a la política.

## 4. Textos de uso de cada permiso (para pegar, en inglés)

**`whatsapp_business_messaging`**

> NAVA and Nexos are software services for appointment-based small businesses (barbershops, pet and fashion shops, veterinary clinics). Nexos is an automated assistant with no user interface of its own: it answers, through the business's WhatsApp number, questions that customers send first (services, prices, products, availability, booking links). It never starts conversations or sends promotional messages. NAVA also sends one-time verification codes to staff members who request them to sign in. Messages are sent only as replies inside the 24-hour customer service window, or with an approved authentication template. Customers can delete their data at any time by sending "borra mis datos" in the chat or by email.

**`whatsapp_business_management`**

> As a Tech Provider, we use this permission to read and manage the phone numbers and WhatsApp Business accounts that businesses connect to our app through Embedded Signup (display name, quality rating, message templates and webhook subscription), so each business's number is routed to its own assistant and templates are kept up to date. We do not read or modify any other asset.

## 5. Guion de los dos videos

El panel de Meta pide **exactamente dos videos**, separados. Ambos en inglés o con subtítulos, con datos ficticios y sin tokens a la vista (tapar `Authorization: Bearer …` o usar una variable de entorno; si un token se ve, rotarlo). Pulsar «Mostrar instrucciones» en cada tarjeta y priorizar lo que diga Meta (duración, resolución, subtítulos).

### Video 1 · `whatsapp_business_messaging`

Meta pide ver **la app enviando el mensaje y la interfaz de WhatsApp (web o móvil) recibiéndolo**. Como Nexos no tiene interfaz, el envío se muestra con NAVA y se añade Nexos como segunda parte.

1. Panel de Meta con la app «NAVA-BARBERIA» y los números conectados.
2. **NAVA**: pantalla de inicio de sesión en `nava.wtf`; se escribe un teléfono de prueba y se pide el código. El código llega por WhatsApp (pantalla del teléfono o WhatsApp Web junto a la pantalla de NAVA).
3. **Nexos**: desde un teléfono de prueba se escribe al número de Nexos («Hola, ¿qué servicios tienen?»). Se ve el aviso de privacidad y la respuesta con servicios y precios. En paralelo, el registro de Odin o la llamada a la API que envía esa respuesta.
4. «borra mis datos» en el chat de Nexos y la confirmación del borrado.
5. `nava.wtf/privacidad`: secciones de Nexos y de eliminación de datos.

Requisito: el envío de NAVA debe salir por **esta misma app de Meta** (mismo ID). El modo `text` (`DEC-124`) sirve; con la plantilla de autenticación aprobada se pasa a `template` cambiando solo `APP_META_WHATSAPP_MODE` y el video queda más fiel a producción.

### Video 2 · `whatsapp_business_management`

Meta pide **llamadas de prueba a la API y un único video, aparte, que muestre la creación de una plantilla de mensaje**. NAVA no tiene pantalla ni servicio que cree plantillas; se hace con la API.

1. La llamada de creación de la plantilla (por ejemplo `curl` o Postman) con su nombre, idioma y categoría (`AUTHENTICATION`).
2. La respuesta con el identificador y el estado (`PENDING` o `APPROVED`).
3. La plantilla ya listada en WhatsApp Manager (nombre, estado, calidad del número).
4. Opcional: suscripción del webhook al campo `messages` y llegada de un evento firmado.

## 6. Cuenta y notas para el revisor

- Usar solo datos ficticios y cuentas demo de producción creadas para la revisión (ver el procedimiento de cuentas demo del propietario). **No escribir credenciales en este repositorio**; entregarlas solo en el formulario de Meta.
- Indicar el número de prueba, qué escribir («Hola, ¿qué servicios tienen?», «borra mis datos») y la respuesta esperada.
- Aclarar que **Nexos no tiene interfaz propia**, que el video de mensajería muestra el envío con NAVA (misma app) y el comportamiento de Nexos en el chat, y que el asistente puede equivocarse y no confirma citas.

## 7. Webhook

- **Nexos (Odin)** recibe en su propio callback `/webhooks/whatsapp` y hoy se publica con un túnel temporal de Cloudflare cuya URL cambia al reiniciar. Un revisor no puede probar contra eso: hace falta un túnel con dominio propio o un subdominio estable con TLS.
- **NAVA** tiene `GET/POST /api/v1/public/webhooks/meta/whatsapp` (`DEC-126`), apagado en producción si no se definen `APP_META_WEBHOOK_VERIFY_TOKEN` y `APP_META_APP_SECRET`.
- Meta permite sobrescribir el callback por número o por cuenta de WhatsApp Business (verificar en la documentación vigente), lo que permitiría que «Nava-Agent» apunte a NAVA y «Nexos» a Odin sin repartir un único callback de la app. Si no fuera posible, habría que repartir los eventos por `phone_number_id` en un solo receptor. Decidirlo y registrarlo como `DEC-*`.

## 8. Plantilla de autenticación del OTP (NAVA)

NAVA entregaba el OTP en texto libre (`APP_META_WHATSAPP_MODE=text`, `DEC-124`) porque Meta rechazó crear la plantilla `AUTHENTICATION` (`code 10`, `subcode 2388185`). El propietario informó el 2026-11-11 que la plantilla ya funciona: cuando esté aprobada y definida, cambiar a `template` (`DEC-123`). El texto libre solo llega a quien escribió al número en las últimas 24 horas, y un revisor lo notará.

## 9. Pendientes por responsable

| Responsable | Pendiente |
| --- | --- |
| NAVA (repositorio) | Política y condiciones con Nexos y eliminación de datos (`#555`, `DEC-163`); esta guía y `DEC-164`; datos técnicos del webhook declarados en la política |
| Propietario, panel de Meta | Quitar `public_profile`; comprobar ícono, categoría y URL; renombrar «Odin-Agent» a «Nexos»; grabar y subir los dos videos; aclarar el estado «En revisión»; pasar la app a modo Live |
| Propietario, NAVA en Meta | Confirmar que NAVA y Nexos usan la misma app; pasar el OTP a `template` con la plantilla aprobada; decidir el callback del webhook |
| Propietario, después de la aprobación | Implementar el Embedded Signup v4 (página con el botón de registro, suscripción de webhooks por cliente, método de pago del cliente) |
| Propietario, Odin | Enlace `https://nava.wtf/privacidad` en `ODIN_PRIVACY_NOTICE`; túnel estable; confirmar retención de 365 días y programar la purga; plazo de retención de las solicitudes de VetEye y verificar el borrado por correo (`DP-LEG-04`) |
| Propietario, jurídico | Revisión jurídica de los textos (`DEC-030`, `DP-LEG-01`) |
