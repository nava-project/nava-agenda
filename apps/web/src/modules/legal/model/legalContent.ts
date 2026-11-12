// Contenido de los documentos legales públicos (issue #545). Es un único
// archivo para que un cambio de texto no obligue a tocar componentes ni
// pruebas, y para que la fecha de vigencia y el canal de contacto vivan en un
// solo sitio.
//
// Los textos son un BORRADOR de buena fe construido sobre lo que la plataforma
// hace de verdad (RN-DAT-01/02/03, DEC-099/101/102), sobre los requisitos de
// la política de datos de usuario de las API de Google y, desde DEC-163, sobre
// lo que hace Nexos (nombre comercial del asistente Odin) con los mensajes de
// WhatsApp, que Meta revisa para publicar la app. No sustituyen una
// revisión jurídica (DEC-025; duda DP-LEG-01): cada vez que el comportamiento
// real cambie —un proveedor nuevo, otro dato recogido, otro plazo— hay que
// actualizar este archivo y `LEGAL_UPDATED`.

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: readonly string[] }
  // Declaración que debe destacarse (p. ej. el Uso limitado de Google); `lang`
  // marca el idioma de la frase cuando no es español.
  | { kind: 'note'; text: string; lang?: string }

export interface LegalSection {
  /** Ancla estable (`#id`): Google y las personas enlazan secciones concretas. */
  id: string
  title: string
  blocks: readonly LegalBlock[]
}

export interface LegalDocument {
  title: string
  /** Frase breve bajo el título: qué es el documento y a quién aplica. */
  lede: string
  sections: readonly LegalSection[]
}

/** Canal único para ejercer derechos y resolver dudas legales. */
export const LEGAL_CONTACT_EMAIL = 'contacto@nava.wtf'
/** Fecha de la versión vigente, en el formato que se muestra. */
export const LEGAL_UPDATED = '10 de noviembre de 2026'
export const LEGAL_UPDATED_ISO = '2026-11-10'

const p = (text: string): LegalBlock => ({ kind: 'p', text })
const ul = (...items: string[]): LegalBlock => ({ kind: 'ul', items })
const note = (text: string, lang?: string): LegalBlock => ({ kind: 'note', text, lang })

export const privacyPolicy: LegalDocument = {
  title: 'Política de privacidad',
  lede: 'Qué datos tratan NAVA Agendas (en adelante, NAVA) y su asistente NAVA Nexos (en adelante, Nexos), para qué, con quién los comparten y cómo puedes ejercer tus derechos, incluida la eliminación de tus datos. Aplica a quienes administran un negocio, a sus barberos, a las personas que reservan una cita y a quienes escriben por WhatsApp a un asistente Nexos.',
  sections: [
    {
      id: 'responsable',
      title: 'Quién es el responsable',
      blocks: [
        p(
          'NAVA Agendas (en adelante, NAVA), de la familia de soluciones para negocios NAVA, es una plataforma web de agenda de citas para barberías y barberos independientes, disponible en https://nava.wtf. NAVA Nexos (en adelante, Nexos) es un asistente automático que atiende por WhatsApp a los clientes de un negocio (se describe en la sección «Nexos, el asistente por WhatsApp»). Ambos los opera Brahian Alexander Caceres Guevara, persona natural, con domicilio en Armenia, Quindío, Colombia. Para cualquier asunto de privacidad escribe a ' +
            LEGAL_CONTACT_EMAIL +
            '.',
        ),
        p(
          'Respecto de las cuentas de quienes usan el panel y de la operación de la plataforma, NAVA es la responsable del tratamiento. Respecto de los clientes de cada negocio, el negocio decide para qué usa esos datos y NAVA y Nexos los tratan por cuenta de él para prestarle el servicio de agenda o de atención. Los registros que Nexos conserva para mejorar su atención (ver su sección) los trata el operador como responsable.',
        ),
      ],
    },
    {
      id: 'datos',
      title: 'Qué datos tratamos',
      blocks: [
        p(
          'Solo pedimos lo necesario para que la agenda funcione. No pedimos documento de identidad, dirección de residencia, fecha de nacimiento ni datos sensibles.',
        ),
        ul(
          'Cuenta del panel (propietario o barbero): nombre, correo electrónico, teléfono cuando se usa para verificar el acceso, rol y una huella irreversible de la contraseña. Nunca guardamos la contraseña en claro.',
          'Datos de la barbería: nombre, dirección y ubicación en el mapa, horarios, servicios, precios y los barberos que la integran.',
          'Quien reserva una cita: nombre, teléfono y correo electrónico, una nota opcional y, si la cita es para otra persona, el nombre de esa persona. No recogemos datos de contacto de menores de edad.',
          'La cita: servicio, fecha y hora, estado e historial de cambios.',
          'Quien escribe a un asistente Nexos por WhatsApp: el texto de sus mensajes, su número de teléfono (solo mientras se responde) y lo que decida contarle; el detalle está en la sección de Nexos.',
          'Datos técnicos mínimos: una cookie de sesión estrictamente necesaria para el panel (HttpOnly y Secure) y registros de seguridad que no contienen nombres, teléfonos, correos ni contenidos de mensajes.',
          'Avisos de WhatsApp: cuando Meta nos informa del estado de un mensaje que enviamos (enviado, entregado, leído o fallido) guardamos su identificador y ese estado durante 30 días, y una huella irreversible de tu teléfono con la hora del último mensaje que nos escribiste, durante 24 horas. No guardamos tu número en claro ni el texto de esos avisos.',
        ),
        p(
          'No usamos cookies de publicidad ni herramientas de analítica o de seguimiento de terceros.',
        ),
      ],
    },
    {
      id: 'finalidades',
      title: 'Para qué usamos los datos',
      blocks: [
        ul(
          'Crear y gestionar la agenda: disponibilidad, reservas, cancelaciones y reprogramaciones.',
          'Verificar tu identidad y proteger el acceso a las cuentas.',
          'Enviar confirmaciones, recordatorios y códigos de verificación relacionados con una cita o con tu cuenta, por correo electrónico y por WhatsApp.',
          'Responder por WhatsApp, en nombre de un negocio, las consultas de quien le escribe a un asistente Nexos (servicios, precios, productos, disponibilidad).',
          'Publicar las citas de un barbero en su Google Calendar, solo si él decide conectarlo (ver la sección sobre datos de Google).',
          'Prevenir fraude y abuso, mantener la seguridad y cumplir obligaciones legales.',
        ),
        p(
          'No vendemos datos personales, no los usamos para publicidad y no elaboramos perfiles comerciales.',
        ),
      ],
    },
    {
      id: 'google',
      title: 'Datos de Google y Google Calendar',
      blocks: [
        p(
          'La conexión con Google Calendar es opcional. Solo ocurre cuando un barbero la inicia desde su panel y autoriza a NAVA en la pantalla de consentimiento de Google. Si no la conecta, NAVA no recibe ningún dato de su cuenta de Google.',
        ),
        p('A qué accedemos, y para qué:'),
        ul(
          'Permiso «Ver y editar eventos en todos tus calendarios» (calendar.events): para crear, actualizar y eliminar en el calendario del barbero los eventos que NAVA publica con sus citas y bloqueos de horario, y para comprobar que esos eventos siguen existiendo y restaurarlos si se borraron por error. NAVA solo consulta y modifica los eventos que ella misma creó.',
          'Permiso de identidad (openid y correo): para mostrar en el panel qué cuenta de Google está conectada.',
        ),
        p(
          'Qué publicamos en el evento: el título con el nombre del cliente y el servicio, la hora, el servicio y el estado de la cita y, si el barbero lo configura, un recordatorio. Nunca incluimos teléfono, correo, notas privadas ni identificadores internos.',
        ),
        p(
          'La publicación es unidireccional, de NAVA hacia Google. NAVA no lee otros eventos de tu calendario y los cambios que hagas en Google Calendar no modifican las citas de NAVA.',
        ),
        p(
          'Cómo los protegemos: la credencial de renovación (refresh token) se guarda cifrada con AES-256-GCM, el token de acceso no se guarda, y ninguna credencial aparece en registros ni se envía al navegador.',
        ),
        p(
          'Con quién se comparten: con nadie. No vendemos ni cedemos datos de Google, no los usamos para publicidad, no los transferimos a terceros salvo lo imprescindible para prestar la función, por obligación legal o con tu consentimiento, no permitimos que personas los lean salvo por seguridad, cumplimiento legal o tu consentimiento expreso, y no los usamos para entrenar modelos de inteligencia artificial.',
        ),
        p(
          'Cómo revocar el acceso: desconecta Google Calendar desde el panel de NAVA, o retira el permiso en https://myaccount.google.com/permissions. Al desconectar desde NAVA revocamos el token, eliminamos las credenciales guardadas y detenemos los trabajos pendientes; los eventos que ya estaban en tu calendario permanecen y puedes borrarlos tú.',
        ),
        note(
          'El uso y la transferencia a cualquier otra aplicación de la información recibida de las API de Google se ajustarán a la Política de datos del usuario de los servicios de las API de Google, incluidos los requisitos de uso limitado.',
        ),
        note(
          'NAVA’s use and transfer to any other app of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements.',
          'en',
        ),
      ],
    },
    {
      id: 'nexos',
      title: 'NAVA Nexos, el asistente por WhatsApp',
      blocks: [
        p(
          'NAVA Nexos, o simplemente Nexos, es el nombre comercial de un asistente conversacional automático. Un negocio (barbería, perfumería, tienda de comida para mascotas, tienda de ropa o veterinaria) lo conecta a su número de WhatsApp para que responda a sus clientes: servicios, precios, productos, disponibilidad y enlaces para reservar. Funciona sobre la WhatsApp Business Platform de Meta. Solo responde cuando la persona escribe primero al número del negocio: no inicia conversaciones ni envía mensajes promocionales.',
        ),
        p('Qué datos recibe y qué guarda:'),
        ul(
          'Al escribir, WhatsApp entrega a Nexos el texto de tu mensaje, tu número de teléfono y el identificador del mensaje. Tu número se mantiene solo en memoria mientras se prepara la respuesta; para recordar el hilo de la conversación usamos un identificador opaco derivado de tu número y del negocio, no el número.',
          'El identificador del mensaje se guarda 7 días, solo para ignorar los reenvíos duplicados que hace Meta.',
          'Los mensajes que no son texto (audios, imágenes, documentos, ubicaciones) no se procesan: se responde con un aviso fijo.',
          'Registro de conversaciones: tu primer mensaje recibe un aviso de privacidad y no se guarda. Si sigues escribiendo, guardamos tus mensajes y las respuestas con los correos, enlaces, teléfonos, documentos, números largos, direcciones y nombres que dices de ti ya ocultos, junto con datos técnicos del turno (qué asistente respondió, versiones, duración). El ocultamiento es automático y no es infalible: por eso te pedimos no compartir datos sensibles ni de menores.',
          'Solicitud de cita (por ejemplo, en una veterinaria): si pides una cita, guardamos el nombre y el teléfono que escribes, el nombre y la especie de la mascota, el servicio y el horario pedidos. Nexos solo la solicita; el negocio decide, y nunca la da por confirmada por su cuenta.',
        ),
        p(
          'Nexos no te pide documento de identidad, dirección, datos de salud de personas ni datos de pago, y no diagnostica ni receta: ante síntomas de una mascota te orienta a pedir una cita o a contactar a la clínica.',
        ),
        p('Para qué los usamos:'),
        ul(
          'Responder tu consulta con la información que el negocio publicó.',
          'Proteger el servicio: limitamos la cantidad de mensajes por persona y por periodo para evitar abusos.',
          'Mejorar la atención: cada cierto tiempo analizamos las conversaciones ya enmascaradas, en equipos propios, para detectar respuestas erróneas y corregir las instrucciones, reglas y pruebas del asistente, siempre con la aprobación de una persona. Una persona puede leer una muestra de esas conversaciones.',
        ),
        p(
          'No usamos las conversaciones para entrenar modelos de inteligencia artificial, ni propios ni de terceros; no las vendemos, no las usamos para publicidad ni para elaborar perfiles comerciales, y no las compartimos con otros negocios.',
        ),
        p(
          'Inteligencia artificial: la respuesta la genera un modelo de lenguaje (DeepSeek-V4-Flash) servido por DeepInfra mediante su API. Para ello le enviamos el texto de la conversación reciente y la información que el negocio publicó, sin tu número de teléfono como dato aparte. Según sus condiciones publicadas, DeepInfra no usa lo que recibe por su API para entrenar modelos. El modelo no puede elegir el negocio, ni consultar los datos de otro, ni modificar la información del negocio. Puede equivocarse: confirma con el negocio los datos importantes, como un precio o un horario.',
        ),
        p(
          'Datos de la plataforma de Meta: usamos los datos que recibimos por la WhatsApp Business Platform solo para responderte y para lo descrito en esta sección. No los vendemos, no los cedemos a intermediarios de datos y no los usamos para publicidad. Cumplimos los Términos de la Plataforma de Meta y las políticas de WhatsApp Business. Tu conversación en WhatsApp también la trata Meta conforme a su propia política de privacidad.',
        ),
        p(
          'Aislamiento entre negocios: cada negocio solo accede a las conversaciones de su propio número. La base de datos impone esa separación y la cuenta con la que opera el asistente no puede saltarla.',
        ),
        p(
          'Cómo pedir que borremos tus datos: escribe «borra mis datos» en la misma conversación, o consulta la sección «Eliminación de tus datos».',
        ),
      ],
    },
    {
      id: 'proveedores',
      title: 'Con quién compartimos datos',
      blocks: [
        p(
          'Usamos proveedores que tratan datos solo para prestarnos su servicio y bajo sus propias condiciones de privacidad:',
        ),
        ul(
          'OVHcloud: infraestructura del servidor donde se alojan NAVA, Nexos y sus copias de respaldo.',
          'Resend: envío de correos de confirmación, recordatorio y verificación.',
          'Meta (WhatsApp Business Platform): envío de códigos de verificación por WhatsApp y, para Nexos, recepción de los mensajes que escribes a un negocio y envío de las respuestas.',
          'DeepInfra: servidor que ejecuta el modelo de lenguaje de Nexos y recibe el texto de la conversación para generar la respuesta.',
          'Cloudflare: túnel cifrado por el que llegan a nuestro servidor los avisos de WhatsApp; ve el tráfico en tránsito, no lo guardamos allí.',
          'Buscadores y fuentes abiertas de perfumes (por ejemplo DeepSeek y Scento), solo cuando el negocio es una perfumería: reciben únicamente un término de búsqueda sobre un producto, nunca tus datos ni tu conversación.',
          'Google: Google Calendar, si el barbero lo conecta, y Google Maps y Places para ubicar la barbería y mostrar su ficha y reseñas. Google puede recibir la dirección IP de quien carga un mapa.',
        ),
        p(
          'Transferencia internacional: Meta, DeepInfra, Cloudflare, Google y los buscadores pueden procesar datos en Estados Unidos u otros países. Para Nexos, al seguir escribiendo después del aviso de privacidad autorizas que el texto de tu conversación se envíe al proveedor del modelo solo para generar la respuesta. También podemos revelar datos cuando una autoridad competente lo exija conforme a la ley.',
        ),
      ],
    },
    {
      id: 'conservacion',
      title: 'Cuánto tiempo los conservamos',
      blocks: [
        p(
          'Conservamos nombre, teléfono, correo y enlaces de acceso de los clientes durante 24 meses por defecto. Al vencer ese plazo, o cuando prospera una solicitud válida de eliminación, los anonimizamos: la cita, el servicio, el estado y su historial se conservan como hechos operativos, pero ya no pueden asociarse a una persona.',
        ),
        p(
          'Las copias de respaldo se rotan y se conservan hasta 30 días. Las credenciales de Google se eliminan al desconectar la integración o al cerrar la cuenta del barbero.',
        ),
        p(
          'Nexos: las conversaciones registradas para mejorar la atención se conservan hasta 12 meses y luego se eliminan; puedes pedir su borrado antes en cualquier momento. El identificador de mensaje de WhatsApp se conserva 7 días. Las solicitudes de cita ya decididas por el negocio se conservan solo el tiempo necesario para gestionarlas y se eliminan o anonimizan cuando el negocio lo pide o tú lo solicitas.',
        ),
      ],
    },
    {
      id: 'seguridad',
      title: 'Cómo protegemos los datos',
      blocks: [
        ul(
          'Conexión cifrada (HTTPS) en toda la plataforma.',
          'Contraseñas almacenadas solo como huella irreversible con un algoritmo diseñado para ello.',
          'Aislamiento entre negocios: un negocio nunca accede a los datos de otro, ni en NAVA ni en Nexos.',
          'Los avisos de WhatsApp solo se aceptan si traen la firma criptográfica de Meta; sin firma válida se rechazan sin procesarlos.',
          'El asistente Nexos opera con permisos mínimos: solo lee la información del negocio y solo puede escribir registros de conversación y solicitudes de cita pendientes.',
          'Credenciales de terceros cifradas y registros técnicos sin datos personales.',
          'Acceso al servidor restringido por llaves y respaldos diarios verificados.',
        ),
        p(
          'Ningún sistema es infalible. Si ocurre un incidente que afecte tus datos, te lo comunicaremos y notificaremos a la autoridad cuando la ley lo exija.',
        ),
      ],
    },
    {
      id: 'derechos',
      title: 'Tus derechos',
      blocks: [
        p('Conforme a la Ley 1581 de 2012 y sus normas reglamentarias, puedes:'),
        ul(
          'Conocer, actualizar y rectificar tus datos.',
          'Solicitar prueba de la autorización que diste y ser informado del uso que se les da.',
          'Pedir que los eliminemos o revocar la autorización cuando no haya un deber legal o contractual de conservarlos.',
          'Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) si consideras que se vulneraron tus derechos.',
        ),
        p(
          'Para ejercerlos escribe a ' +
            LEGAL_CONTACT_EMAIL +
            ' indicando tu nombre y qué necesitas; podemos pedirte datos para confirmar que eres tú. Respondemos las consultas en máximo 10 días hábiles y los reclamos en máximo 15 días hábiles, prorrogables en los términos de la ley. Si tu cita es con una barbería, o escribiste a Nexos en nombre de un negocio, también puedes dirigirte a él.',
        ),
      ],
    },
    {
      id: 'eliminar-datos',
      title: 'Eliminación de tus datos',
      blocks: [
        p('Puedes pedir que eliminemos tus datos por cualquiera de estas vías:'),
        ul(
          'Desde WhatsApp, en la conversación con el asistente Nexos: escribe «borra mis datos» o «no guardes mi conversación». Borramos lo guardado de esa conversación y no volvemos a guardarla; si el borrado falla, el asistente no te dirá que se hizo.',
          'Por correo a ' +
            LEGAL_CONTACT_EMAIL +
            ' con el asunto «Eliminar mis datos», indicando el negocio al que escribiste y el número de WhatsApp desde el que lo hiciste (o tu nombre y teléfono si reservaste una cita). Te pediremos confirmar que eres la persona titular antes de actuar.',
          'Si conectaste Google Calendar, desconéctalo desde el panel de NAVA o retira el permiso en https://myaccount.google.com/permissions.',
        ),
        p(
          'Respondemos en máximo 15 días hábiles. En NAVA anonimizamos tus datos personales y conservamos la cita y su historial como hechos operativos que ya no pueden asociarse a ti; en Nexos borramos tus conversaciones y tus solicitudes de cita. Lo que está en tu propio WhatsApp y en los servidores de Meta se rige por la política de WhatsApp: borrar nuestros registros no borra tu chat.',
        ),
      ],
    },
    {
      id: 'menores',
      title: 'Menores de edad',
      blocks: [
        p(
          'NAVA y Nexos no están dirigidos a menores de edad. Cuando un adulto reserva para un menor, solo se registra el nombre de la persona atendida y no sus datos de contacto. Si escribes a Nexos, no compartas datos de menores.',
        ),
      ],
    },
    {
      id: 'cambios',
      title: 'Cambios en esta política',
      blocks: [
        p(
          'Si cambiamos esta política, publicaremos la nueva versión en esta página con su fecha de actualización. Cuando el cambio sea importante, o afecte datos de Google, te lo avisaremos por un medio visible antes de aplicarlo.',
        ),
      ],
    },
    {
      id: 'contacto',
      title: 'Contacto',
      blocks: [
        p(
          'Correo de contacto de NAVA y Nexos para consultas, reclamos y solicitudes de eliminación de datos: ' +
            LEGAL_CONTACT_EMAIL +
            '.',
        ),
        p('Responsable: Brahian Alexander Caceres Guevara · Armenia, Quindío, Colombia.'),
      ],
    },
  ],
}

export const termsOfService: LegalDocument = {
  title: 'Condiciones del servicio',
  lede: 'Las reglas para usar NAVA Agendas (en adelante, NAVA), la plataforma de agenda de citas para barberías, y NAVA Nexos (en adelante, Nexos), su asistente automático de WhatsApp. Al crear una cuenta, usar la plataforma o seguir una conversación con Nexos las aceptas.',
  sections: [
    {
      id: 'aceptacion',
      title: 'Quién presta el servicio y aceptación',
      blocks: [
        p(
          'NAVA y Nexos los opera Brahian Alexander Caceres Guevara, persona natural, de Armenia, Quindío, Colombia (' +
            LEGAL_CONTACT_EMAIL +
            '). Al usar https://nava.wtf, o al seguir escribiendo a un asistente Nexos después de su aviso de privacidad, declaras que leíste estas condiciones y la Política de privacidad y que las aceptas. Si no estás de acuerdo, no uses la plataforma ni el asistente.',
        ),
      ],
    },
    {
      id: 'servicio',
      title: 'Qué es NAVA y qué no es',
      blocks: [
        p(
          'NAVA es una herramienta para que una barbería o un barbero independiente publique su disponibilidad, reciba reservas y administre su agenda, y para que sus clientes reserven y consulten su cita.',
        ),
        p(
          'NAVA no presta servicios de barbería, no es parte del acuerdo entre la barbería y su cliente y no procesa pagos de los servicios: el pago se resuelve directamente entre ambos.',
        ),
      ],
    },
    {
      id: 'nexos',
      title: 'NAVA Nexos, el asistente por WhatsApp',
      blocks: [
        p(
          'NAVA Nexos es un asistente automático, basado en inteligencia artificial, que un negocio conecta a su número de WhatsApp para atender a sus clientes: informa servicios, precios, productos y disponibilidad y comparte enlaces. Solo responde a quien le escribe primero y no envía mensajes promocionales.',
        ),
        ul(
          'Es un asistente automático, no una persona. Sus respuestas son informativas y pueden contener errores: confirma con el negocio los datos importantes, como precios, horarios o disponibilidad.',
          'No presta asesoría médica, veterinaria, legal ni financiera. No diagnostica ni receta: ante síntomas de una mascota te orienta a pedir una cita o a contactar a la clínica, y en una urgencia debes acudir a ella o llamar.',
          'No confirma citas ni compromisos del negocio. Cuando permite pedir una cita, solo la solicita; el negocio decide si la acepta.',
          'No procesa pagos. Cualquier compra o pago se resuelve directamente con el negocio.',
          'Aplica límites de uso por persona y por periodo para proteger el servicio.',
          'Para que borremos tu conversación escribe «borra mis datos»; los detalles están en la Política de privacidad.',
        ),
        p(
          'El negocio que contrata Nexos es responsable de que el número de WhatsApp sea suyo, de la información que publica (precios, horarios, productos), de contar con autorización para tratar los datos de sus clientes y de cumplir las normas de WhatsApp. No puede usar Nexos para enviar spam, contactar a personas que no le escribieron ni vender productos prohibidos por las políticas de WhatsApp Business. Podemos suspender un número que incumpla estas reglas.',
        ),
        p(
          'El uso de WhatsApp se rige además por los Términos de servicio de WhatsApp Business, la Política de mensajería de WhatsApp Business y las Condiciones de la Plataforma de Meta, a las que debes ajustarte.',
        ),
      ],
    },
    {
      id: 'cuentas',
      title: 'Cuentas y responsabilidad',
      blocks: [
        ul(
          'Debes dar datos verdaderos y mantenerlos actualizados.',
          'Eres responsable de tu contraseña y de lo que se haga con tu cuenta. Avísanos si sospechas un acceso no autorizado.',
          'El propietario de la barbería responde por las personas a las que da acceso al panel y por los datos que registra de sus clientes, y debe contar con su autorización para tratarlos.',
          'Debes ser mayor de edad para crear una cuenta.',
        ),
      ],
    },
    {
      id: 'uso',
      title: 'Uso aceptable',
      blocks: [
        p('No puedes:'),
        ul(
          'Suplantar a otra persona o negocio, ni registrar datos de terceros sin su autorización.',
          'Reservar de forma masiva, automatizada o con datos falsos para bloquear la agenda de otros.',
          'Intentar vulnerar la seguridad, acceder a datos de otras barberías o interferir con el funcionamiento de la plataforma.',
          'Usar los datos de los clientes para fines distintos a la gestión de sus citas.',
          'Usar NAVA para actividades ilegales o que infrinjan derechos de otros.',
        ),
      ],
    },
    {
      id: 'reservas',
      title: 'Reservas y citas',
      blocks: [
        p(
          'Cada barbería define sus servicios, precios, horarios y reglas de cancelación. NAVA muestra esa información y registra las reservas, pero no garantiza que la barbería atienda ni se hace responsable de la calidad del servicio, de inasistencias o de diferencias entre las partes.',
        ),
        p(
          'Podemos enviar mensajes relacionados con tu cita, como confirmaciones, recordatorios y códigos de verificación, por correo electrónico o WhatsApp.',
        ),
      ],
    },
    {
      id: 'terceros',
      title: 'Servicios de terceros',
      blocks: [
        p(
          'NAVA y Nexos se apoyan en servicios de terceros, como Google Calendar, Google Maps, WhatsApp (Meta), un proveedor de modelos de lenguaje y el correo electrónico. Esas integraciones son opcionales cuando es posible, se rigen también por las condiciones de cada tercero y pueden fallar o cambiar sin que NAVA lo controle. Una falla de un tercero no impide crear una cita en NAVA; si Nexos no está disponible, puedes contactar directamente al negocio.',
        ),
      ],
    },
    {
      id: 'datos',
      title: 'Datos y privacidad',
      blocks: [
        p(
          'El tratamiento de datos personales se rige por la Política de privacidad, disponible en https://nava.wtf/privacidad. Los datos que registra un negocio siguen siendo suyos; NAVA y Nexos los usan solo para prestarle el servicio.',
        ),
      ],
    },
    {
      id: 'propiedad',
      title: 'Propiedad intelectual',
      blocks: [
        p(
          'Las marcas NAVA y Nexos, la plataforma, su diseño y su código son propiedad de su titular y están protegidos por la ley. Estas condiciones no te transfieren ningún derecho sobre ellos más allá del uso de la plataforma conforme a este documento.',
        ),
      ],
    },
    {
      id: 'disponibilidad',
      title: 'Disponibilidad y cambios del servicio',
      blocks: [
        p(
          'Procuramos que NAVA y Nexos estén disponibles de forma continua, pero se ofrece «tal cual»: puede haber interrupciones por mantenimiento, fallas o causas ajenas. Podemos modificar, añadir o retirar funciones.',
        ),
      ],
    },
    {
      id: 'responsabilidad',
      title: 'Limitación de responsabilidad',
      blocks: [
        p(
          'En la medida que lo permita la ley colombiana, NAVA no responde por daños indirectos, lucro cesante o pérdida de ingresos derivados del uso o de la imposibilidad de usar la plataforma, ni por actos u omisiones de las barberías y demás negocios, de sus clientes o de terceros, ni por errores de las respuestas automáticas. Nada de lo anterior limita los derechos que la ley reconoce a los consumidores.',
        ),
      ],
    },
    {
      id: 'suspension',
      title: 'Suspensión y terminación',
      blocks: [
        p(
          'Puedes dejar de usar NAVA o Nexos y pedir el cierre de tu cuenta cuando quieras escribiendo a ' +
            LEGAL_CONTACT_EMAIL +
            '. Podemos suspender o cerrar una cuenta que incumpla estas condiciones o ponga en riesgo la plataforma o a otras personas.',
        ),
      ],
    },
    {
      id: 'ley',
      title: 'Ley aplicable',
      blocks: [
        p(
          'Estas condiciones se rigen por las leyes de la República de Colombia. Cualquier controversia se someterá a los jueces competentes en Colombia, sin perjuicio de las vías de reclamación que la ley otorga a los consumidores.',
        ),
      ],
    },
    {
      id: 'cambios',
      title: 'Cambios en estas condiciones',
      blocks: [
        p(
          'Podemos actualizar estas condiciones. Publicaremos la versión nueva en esta página con su fecha y, si el cambio es importante, te avisaremos antes de aplicarlo. Si sigues usando NAVA después, entiendes que la aceptas.',
        ),
      ],
    },
    {
      id: 'contacto',
      title: 'Contacto',
      blocks: [
        p(
          'Correo de contacto de NAVA y Nexos: ' +
            LEGAL_CONTACT_EMAIL +
            '. ¿Dudas sobre estas condiciones? Escríbenos allí.',
        ),
      ],
    },
  ],
}
