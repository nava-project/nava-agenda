// Contenido de la landing pública. Es un único archivo para que un cambio de
// contacto o de copy no obligue a tocar componentes ni pruebas.
//
// Los datos de contacto son los que el propietario entregó para su
// publicación el 2026-11-03 (DEC-151). Viven aquí y en ningún otro sitio: las
// pruebas los leen de este módulo y no los repiten.

export interface LandingContactAction {
  /** Texto del botón. */
  label: string
  /** Enlace que abre la acción nativa: WhatsApp, llamada o correo. */
  href: string
  /** Los enlaces web se abren en otra pestaña; tel: y mailto: no. */
  external: boolean
}

export interface LandingContact {
  /** Nombre visible del canal. */
  label: string
  /** Texto que se muestra, con el formato legible para una persona. */
  display: string
  /** Acciones nativas del canal; la primera es la principal. */
  actions: readonly LandingContactAction[]
  /** Valor que copia el botón «Copiar». */
  copyValue: string
}

const PHONE_E164 = '+573016823624'
const PHONE_DISPLAY = '+57 301 682 3624'
const EMAIL = 'bacg20044@gmail.com'

const WHATSAPP_GREETING =
  'Hola, vi la página de NAVA y quiero saber cómo contratarla para mi negocio.'

// Un solo número atiende por WhatsApp y por llamada: es una fila con dos
// acciones, no dos canales repetidos.
export const landingContacts: readonly LandingContact[] = [
  {
    label: 'WhatsApp y llamadas',
    display: PHONE_DISPLAY,
    copyValue: PHONE_E164,
    actions: [
      {
        label: 'Escribir por WhatsApp',
        href: `https://wa.me/${PHONE_E164.slice(1)}?text=${encodeURIComponent(WHATSAPP_GREETING)}`,
        external: true,
      },
      { label: 'Llamar', href: `tel:${PHONE_E164}`, external: false },
    ],
  },
  {
    label: 'Correo',
    display: EMAIL,
    copyValue: EMAIL,
    actions: [
      {
        label: 'Enviar un correo',
        href: `mailto:${EMAIL}?subject=${encodeURIComponent('Quiero contratar NAVA')}`,
        external: false,
      },
    ],
  },
]

export interface LandingCapability {
  id: string
  title: string
  body: string
}

// Solo funciones que NAVA ya entrega o tiene confirmadas en el alcance P0
// (docs/01-producto/alcance-mvp.md). La landing no promete nada más.
export const landingCapabilities: readonly LandingCapability[] = [
  {
    id: 'agenda',
    title: 'Agenda viva del día',
    body: 'Cada turno en su carril, con su hora, su persona y su estado. Confirma, reprograma, cancela o marca quién no llegó, sin perder el hilo del día.',
  },
  {
    id: 'reserva',
    title: 'Reservas con tu propio enlace',
    body: 'Tus clientes eligen servicio, profesional y horario desde el celular, sin crear cuenta. Solo ven huecos que de verdad existen.',
  },
  {
    id: 'horarios',
    title: 'Horarios, excepciones y bloqueos',
    body: 'Jornada semanal por profesional, días especiales y bloqueos puntuales o por series. Si algo se cruza con un turno, NAVA te lo dice antes de guardar.',
  },
  {
    id: 'recordatorios',
    title: 'Recordatorios que reducen ausencias',
    body: 'Aviso automático antes de cada cita por correo y WhatsApp, y se actualiza solo cuando el turno cambia.',
  },
  {
    id: 'equipo',
    title: 'Equipo, servicios y reseñas',
    body: 'Quién ofrece qué, con qué precio y duración. Tus clientes califican al terminar y tu reputación se ve donde reservan.',
  },
  {
    id: 'calendario',
    title: 'Tu calendario de Google al día',
    body: 'Cada profesional puede ver sus turnos y bloqueos en su propio Google Calendar.',
  },
]

export interface AssistantLine {
  from: 'client' | 'assistant'
  text: string
  /** Horas ofrecidas como fichas bajo el mensaje del asistente. */
  slots?: readonly string[]
}

// Conversación de demostración. Es ficticia a propósito: no hay nombres,
// teléfonos ni horarios de ninguna barbería real.
export const assistantDemo: readonly AssistantLine[] = [
  { from: 'client', text: 'Hola, ¿tienen un hueco hoy después de las 5?' },
  {
    from: 'assistant',
    text: 'Claro. Hoy tenemos estas horas libres con cualquier profesional:',
    slots: ['5:30 pm', '6:15 pm', '7:00 pm'],
  },
  { from: 'client', text: 'La de las 5:30, por favor.' },
  {
    from: 'assistant',
    text: 'Perfecto. Te dejo el enlace de reserva para que la confirmes con tu nombre y tu número.',
  },
]

export const assistantPoints: readonly { title: string; body: string }[] = [
  {
    title: 'Contesta mientras trabajas',
    body: 'Servicios, precios, horarios y profesionales, a cualquier hora, sin que tengas que soltar lo que estás haciendo.',
  },
  {
    title: 'Habla con la agenda real',
    body: 'Consulta la disponibilidad de NAVA en vez de adivinar. Si no hay hueco, no lo promete.',
  },
  {
    title: 'Lleva al cliente a reservar',
    body: 'Cierra la conversación con el enlace de reserva de tu negocio, listo para confirmar.',
  },
]

export interface JourneyStep {
  time: string
  title: string
  body: string
}

// El recorrido de un turno. Cada paso describe algo que NAVA ya hace o que el
// alcance P0 confirma (reserva pública, agenda, recordatorios, reseñas).
export const journeySteps: readonly JourneyStep[] = [
  {
    time: '8:40 am · Un cliente escribe',
    title: 'Pregunta por el chat y recibe respuesta al instante',
    body: 'El asistente de IA mira la agenda real, ofrece las horas libres y le pasa el enlace de reserva de tu negocio.',
  },
  {
    time: '8:42 am · Reserva',
    title: 'Elige servicio, profesional y hora desde su celular',
    body: 'Sin crear cuenta ni descargar nada. Solo ve horarios que existen y confirma con su nombre y su número.',
  },
  {
    time: '8:42 am · Tu agenda',
    title: 'El turno aparece solo en tu agenda',
    body: 'Cae en el carril del profesional, con su hora y su estado. El hueco queda ocupado y nadie más puede tomarlo.',
  },
  {
    time: 'Antes de la cita · Recordatorio',
    title: 'Un aviso a tiempo, para que no se olvide',
    body: 'NAVA le escribe por correo y WhatsApp antes del turno, con un enlace para verlo o cambiarlo. Si algo cambia, el aviso se actualiza.',
  },
  {
    time: 'Después · Cierre',
    title: 'Atendido, y la reputación se construye sola',
    body: 'Marcas el turno como atendido y tu cliente puede calificar al profesional. Las reseñas se ven donde otros van a reservar.',
  },
]

export interface LandingStep {
  title: string
  body: string
}

// Cómo se empieza. Sin plazos ni precios: la landing no promete lo que no
// está acordado.
export const startSteps: readonly LandingStep[] = [
  {
    title: 'Hablamos',
    body: 'Nos cuentas si trabajas por tu cuenta o con un equipo, y cómo agendas hoy.',
  },
  {
    title: 'Armamos tu NAVA',
    body: 'Cargamos tus servicios y tus horarios (y tu equipo, si lo tienes), con tu color y tus palabras.',
  },
  {
    title: 'Abres tu agenda',
    body: 'Compartes tu enlace de reservas y empiezas a recibir turnos.',
  },
]

export interface LandingAudience {
  id: 'independiente' | 'equipo'
  title: string
  lead: string
  points: readonly string[]
}

// Los dos perfiles de panel que NAVA ya tiene (DEC-115, DEC-134): quien trabaja
// por su cuenta y quien dirige un equipo.
export const landingAudiences: readonly LandingAudience[] = [
  {
    id: 'independiente',
    title: 'Trabajo por mi cuenta',
    lead: 'Tu agenda, tu enlace de reservas y tus horarios. Sin pantallas de equipo que no necesitas.',
    points: [
      'Un panel hecho para una sola persona',
      'Tu propio enlace para que reserven sin escribirte',
      'Recordatorios que reducen las ausencias',
    ],
  },
  {
    id: 'equipo',
    title: 'Dirijo un equipo',
    lead: 'Varios profesionales, cada uno con sus servicios, su horario y su agenda, y tú viendo todo el día.',
    points: [
      'Una agenda con un carril por profesional',
      'Servicios y horarios distintos para cada persona',
      'Reseñas y reputación por profesional',
    ],
  },
]

// Ejemplos, no un catálogo cerrado: NAVA sirve a cualquier negocio que agende
// citas (el nombre del negocio y del equipo se configuran, DEC-110/DEC-119).
export const landingNiches: readonly string[] = [
  'Barberías',
  'Salones de belleza',
  'Estudios de uñas',
  'Spas y masajes',
  'Tatuajes y piercing',
  'Consultorios y terapias',
  'Y cualquier negocio que agende citas',
]
