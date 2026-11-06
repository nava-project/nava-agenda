// Contenido de los documentos legales públicos (issue #545). Es un único
// archivo para que un cambio de texto no obligue a tocar componentes ni
// pruebas, y para que la fecha de vigencia y el canal de contacto vivan en un
// solo sitio.
//
// Los textos son un BORRADOR de buena fe construido sobre lo que la plataforma
// hace de verdad (RN-DAT-01/02/03, DEC-099/101/102) y sobre los requisitos de
// la política de datos de usuario de las API de Google. No sustituyen una
// revisión jurídica (DEC-025; duda DP-LEG-01): cada vez que el comportamiento
// real cambie —un proveedor nuevo, otro dato recogido, otro plazo— hay que
// actualizar este archivo y `LEGAL_UPDATED`.

export type LegalBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: readonly string[] }

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
export const LEGAL_UPDATED = '6 de noviembre de 2026'
export const LEGAL_UPDATED_ISO = '2026-11-06'

const p = (text: string): LegalBlock => ({ kind: 'p', text })
const ul = (...items: string[]): LegalBlock => ({ kind: 'ul', items })

export const privacyPolicy: LegalDocument = {
  title: 'Política de privacidad',
  lede: 'Qué datos trata NAVA, para qué, con quién los comparte y cómo puedes ejercer tus derechos. Aplica a quienes administran una barbería en NAVA, a sus barberos y a las personas que reservan una cita.',
  sections: [
    {
      id: 'responsable',
      title: 'Quién es el responsable',
      blocks: [
        p(
          'NAVA es una plataforma web de agenda de citas para barberías y barberos independientes, disponible en https://nava.wtf. La opera Brahian Alexander Caceres Guevara, persona natural, con domicilio en Armenia, Quindío, Colombia. Para cualquier asunto de privacidad escribe a ' +
            LEGAL_CONTACT_EMAIL +
            '.',
        ),
        p(
          'Respecto de las cuentas de quienes usan el panel y de la operación de la plataforma, NAVA es la responsable del tratamiento. Respecto de los clientes de cada barbería, la barbería decide para qué usa esos datos y NAVA los trata por cuenta de ella para prestarle el servicio de agenda.',
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
          'Datos técnicos mínimos: una cookie de sesión estrictamente necesaria para el panel (HttpOnly y Secure) y registros de seguridad que no contienen nombres, teléfonos, correos ni contenidos de mensajes.',
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
        p(
          'El uso y la transferencia a cualquier otra aplicación de la información recibida de las API de Google se ajustarán a la Política de datos del usuario de los servicios de las API de Google, incluidos los requisitos de uso limitado.',
        ),
        p(
          'NAVA’s use and transfer to any other app of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements.',
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
          'OVHcloud: infraestructura del servidor donde se aloja NAVA y sus copias de respaldo.',
          'Resend: envío de correos de confirmación, recordatorio y verificación.',
          'Meta (WhatsApp Business Platform): envío de códigos de verificación por WhatsApp.',
          'Google: Google Calendar, si el barbero lo conecta, y Google Maps y Places para ubicar la barbería y mostrar su ficha y reseñas. Google puede recibir la dirección IP de quien carga un mapa.',
        ),
        p(
          'Algunos de estos proveedores procesan datos fuera de Colombia. También podemos revelar datos cuando una autoridad competente lo exija conforme a la ley.',
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
          'Las copias de respaldo se rotan y se conservan 30 días. Las credenciales de Google se eliminan al desconectar la integración o al cerrar la cuenta del barbero.',
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
          'Aislamiento entre barberías: una barbería nunca accede a los datos de otra.',
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
            ' indicando tu nombre y qué necesitas; podemos pedirte datos para confirmar que eres tú. Respondemos las consultas en máximo 10 días hábiles y los reclamos en máximo 15 días hábiles, prorrogables en los términos de la ley. Si tu cita es con una barbería, también puedes dirigirte a ella.',
        ),
      ],
    },
    {
      id: 'menores',
      title: 'Menores de edad',
      blocks: [
        p(
          'NAVA no está dirigida a menores de edad. Cuando un adulto reserva para un menor, solo se registra el nombre de la persona atendida y no sus datos de contacto.',
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
          'Brahian Alexander Caceres Guevara · Armenia, Quindío, Colombia · ' + LEGAL_CONTACT_EMAIL,
        ),
      ],
    },
  ],
}

export const termsOfService: LegalDocument = {
  title: 'Condiciones del servicio',
  lede: 'Las reglas para usar NAVA, la plataforma de agenda de citas para barberías. Al crear una cuenta o usar la plataforma las aceptas.',
  sections: [
    {
      id: 'aceptacion',
      title: 'Quién presta el servicio y aceptación',
      blocks: [
        p(
          'NAVA la opera Brahian Alexander Caceres Guevara, persona natural, de Armenia, Quindío, Colombia (' +
            LEGAL_CONTACT_EMAIL +
            '). Al usar https://nava.wtf declaras que leíste estas condiciones y la Política de privacidad y que las aceptas. Si no estás de acuerdo, no uses la plataforma.',
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
          'NAVA se apoya en servicios de terceros, como Google Calendar, Google Maps, WhatsApp y el correo electrónico. Esas integraciones son opcionales cuando es posible, se rigen también por las condiciones de cada tercero y pueden fallar o cambiar sin que NAVA lo controle. Una falla de un tercero no impide crear una cita en NAVA.',
        ),
      ],
    },
    {
      id: 'datos',
      title: 'Datos y privacidad',
      blocks: [
        p(
          'El tratamiento de datos personales se rige por la Política de privacidad, disponible en https://nava.wtf/privacidad. Los datos que registra una barbería siguen siendo suyos; NAVA los usa solo para prestarle el servicio.',
        ),
      ],
    },
    {
      id: 'propiedad',
      title: 'Propiedad intelectual',
      blocks: [
        p(
          'La marca NAVA, la plataforma, su diseño y su código son propiedad de su titular y están protegidos por la ley. Estas condiciones no te transfieren ningún derecho sobre ellos más allá del uso de la plataforma conforme a este documento.',
        ),
      ],
    },
    {
      id: 'disponibilidad',
      title: 'Disponibilidad y cambios del servicio',
      blocks: [
        p(
          'Procuramos que NAVA esté disponible de forma continua, pero se ofrece «tal cual»: puede haber interrupciones por mantenimiento, fallas o causas ajenas. Podemos modificar, añadir o retirar funciones.',
        ),
      ],
    },
    {
      id: 'responsabilidad',
      title: 'Limitación de responsabilidad',
      blocks: [
        p(
          'En la medida que lo permita la ley colombiana, NAVA no responde por daños indirectos, lucro cesante o pérdida de ingresos derivados del uso o de la imposibilidad de usar la plataforma, ni por actos u omisiones de las barberías, de sus clientes o de terceros. Nada de lo anterior limita los derechos que la ley reconoce a los consumidores.',
        ),
      ],
    },
    {
      id: 'suspension',
      title: 'Suspensión y terminación',
      blocks: [
        p(
          'Puedes dejar de usar NAVA y pedir el cierre de tu cuenta cuando quieras escribiendo a ' +
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
      blocks: [p('¿Dudas sobre estas condiciones? Escribe a ' + LEGAL_CONTACT_EMAIL + '.')],
    },
  ],
}
