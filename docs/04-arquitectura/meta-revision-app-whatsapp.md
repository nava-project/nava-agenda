---
titulo: "Guía de revisión de la app de Meta (NAVA y Nexos)"
version: "1.0"
estado: "Vigente; las pantallas de Meta cambian, verificar contra la documentación oficial"
responsable: "Propietario del proyecto"
ultima_actualizacion: "2026-11-10"
documentos_relacionados:
  - "00-control/registro-decisiones.md"
  - "04-arquitectura/stack-despliegue-operacion.md"
---

# Guía de revisión de la app de Meta (NAVA y Nexos)

Checklist para publicar la app «NAVA-BARBERIA» de Meta (WhatsApp Business Platform) a nivel comercial. **Nexos** es el nombre comercial del asistente Odin. Las partes que son de Odin las ejecuta el propietario en su repositorio; aquí solo se enumeran para no perderlas. Decisiones relacionadas: `DEC-123`, `DEC-124`, `DEC-126`, `DEC-161`, `DEC-163`.

## 1. Estado de partida (2026-11-10)

| Requisito del panel de Meta | Estado |
| --- | --- |
| Caso de uso «Conectarte con los clientes a través de WhatsApp» | Hecho |
| Inicio de sesión con Facebook para empresas | Hecho |
| Requisitos de las pruebas | Hecho |
| Verificación del negocio | Hecho |
| Revisión de la app | **Pendiente** |
| Publicar (la app figura «Sin publicar») | **Pendiente** |

Números de la cuenta: «Nava-Agent» (conectado, calidad alta) y «Odin-Agent» (pendiente, nombre en revisión; renombrar a **Nexos**).

## 2. Decisión previa: ¿necesita Meta una revisión?

El acceso avanzado (`whatsapp_business_messaging`, `whatsapp_business_management`) y la revisión de la app son necesarios cuando la app envía mensajes **en nombre de otros negocios** (clientes con su propia cuenta de WhatsApp Business). Si cada negocio usara solo un número de la cuenta del propietario, el acceso estándar podría bastar. Como el objetivo es vender Nexos y NAVA a negocios distintos, hay que decidir cómo se incorporan sus números:

- **Registro integrado (Embedded Signup)** y programa de **proveedor de tecnología**: el negocio conecta su propio número desde un flujo de Meta. Es el camino previsto por Meta para este modelo y exige que la app lo muestre en la revisión.
- **Alta manual por el propietario** de cada número en su cuenta: no escala y puede no cumplir la política de Meta.

Verificar en la documentación vigente de Meta («Become a Tech Provider» y «Embedded Signup») antes de grabar nada, porque cambia por versión. Esta decisión debe registrarse como `DEC-*` cuando se tome; hasta entonces la guía se redacta para el escenario de acceso avanzado.

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

**Comprobar antes de pegar las URL** que el despliegue de `#556` ya está en producción y que la política abre y menciona a Nexos y la sección «Eliminación de tus datos».

## 4. Textos de uso de cada permiso (para pegar, en inglés)

**`whatsapp_business_messaging`**

> NAVA and Nexos are software services for appointment-based small businesses (barbershops, pet and fashion shops, veterinary clinics). Nexos is an automated assistant that answers, through the business's WhatsApp number, questions that customers send first (services, prices, products, availability, booking links). It never starts conversations or sends promotional messages. NAVA also sends one-time verification codes to staff members who request them to sign in. Messages are sent only as replies inside the 24-hour customer service window, or with an approved authentication template. Customers can delete their data at any time by sending "borra mis datos" in the chat or by email.

**`whatsapp_business_management`**

> We use this permission to read and manage the phone numbers and WhatsApp Business accounts that businesses connect to our app (display name, quality rating, message templates and webhook subscription), so each business's number is routed to its own assistant and templates are kept up to date. We do not read or modify any other asset.

Ajustar el segundo texto al modelo elegido en la sección 2 (si hay Embedded Signup, descríbelo).

## 5. Guion de los videos

Meta pide que el video muestre **la interfaz de la aplicación del negocio y cómo usa el permiso**, no solo el chat del consumidor. Un video por permiso, en inglés o con subtítulos, de 2 a 4 minutos, con datos ficticios y sin tokens a la vista.

**`whatsapp_business_messaging`**

1. Panel de Meta con la app y el número conectado.
2. La interfaz del negocio: el panel de NAVA (agenda, configuración del negocio) y cómo se asocia un número a una empresa (alta de la ruta en Odin).
3. Un teléfono real escribe al número: aparece el aviso de privacidad y la respuesta de Nexos con servicios y precios.
4. Ese mismo mensaje y su respuesta, vistos desde el lado del negocio, si existe una vista.
5. «borra mis datos»: se confirma el borrado.
6. NAVA: solicitud de código de acceso y recepción del código por WhatsApp.
7. `nava.wtf/privacidad`: secciones de Nexos y de eliminación de datos.

**`whatsapp_business_management`**

1. Cómo el negocio conecta o se le asigna su número (flujo del modelo elegido en la sección 2).
2. Dónde se ve el nombre, el estado y la calidad del número y las plantillas.
3. Suscripción del webhook al campo `messages` y llegada de un evento firmado.

## 6. Cuenta y notas para el revisor

- Usar solo datos ficticios y cuentas demo de producción creadas para la revisión (ver el procedimiento de cuentas demo del propietario). **No escribir credenciales en este repositorio**; entregarlas solo en el formulario de Meta.
- Indicar el número de prueba, qué escribir («Hola, ¿qué servicios tienen?», «borra mis datos») y la respuesta esperada.
- Aclarar que el asistente puede equivocarse y que no confirma citas.

## 7. Webhook

- **Nexos (Odin)** recibe en su propio callback `/webhooks/whatsapp` y hoy se publica con un túnel temporal de Cloudflare cuya URL cambia al reiniciar. Un revisor no puede probar contra eso: hace falta un túnel con dominio propio o un subdominio estable con TLS.
- **NAVA** tiene `GET/POST /api/v1/public/webhooks/meta/whatsapp` (`DEC-126`), apagado en producción si no se definen `APP_META_WEBHOOK_VERIFY_TOKEN` y `APP_META_APP_SECRET`.
- Meta permite sobrescribir el callback por número o por cuenta de WhatsApp Business (verificar en la documentación vigente), lo que permitiría que «Nava-Agent» apunte a NAVA y «Nexos» a Odin sin repartir un único callback de la app. Si no fuera posible, habría que repartir los eventos por `phone_number_id` en un solo receptor. Decidirlo y registrarlo como `DEC-*`.

## 8. Plantilla de autenticación del OTP (NAVA)

Hoy NAVA entrega el OTP en texto libre (`APP_META_WHATSAPP_MODE=text`, `DEC-124`) porque Meta rechazó crear la plantilla `AUTHENTICATION` (`code 10`, `subcode 2388185`). El texto libre solo llega a quien escribió al número en las últimas 24 horas, y un revisor lo notará. Con la verificación del negocio ya hecha, **reintentar crear la plantilla** en el administrador de WhatsApp y, cuando exista, cambiar a `template` (`DEC-123`). Si no se habilita, documentar la limitación en las notas del revisor.

## 9. Pendientes por responsable

| Responsable | Pendiente |
| --- | --- |
| NAVA (repositorio) | Política y condiciones con Nexos y eliminación de datos (`#555`, `DEC-163`); esta guía; datos técnicos del webhook declarados en la política |
| Propietario, panel de Meta | Cargar las URL, el ícono y los permisos; renombrar «Odin-Agent» a «Nexos»; decidir el modelo de alta de números (sección 2); grabar y subir los videos; pasar la app a modo Live |
| Propietario, NAVA en Meta | Reintentar la plantilla `AUTHENTICATION`; decidir el callback del webhook |
| Propietario, Odin | Enlace `https://nava.wtf/privacidad` en `ODIN_PRIVACY_NOTICE`; túnel estable; confirmar retención de 365 días y programar la purga; plazo de retención de las solicitudes de VetEye y verificar el borrado por correo (`DP-LEG-04`) |
| Propietario, jurídico | Revisión jurídica de los textos (`DEC-030`, `DP-LEG-01`) |
