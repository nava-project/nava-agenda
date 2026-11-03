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
  'Hola, vi la página de NAVA y quiero saber cómo contratarla para mi barbería.'

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
  { from: 'client', text: 'Hola, ¿tienen un hueco hoy después de las 5 para corte y barba?' },
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
    body: 'Cierra la conversación con el enlace de reserva de tu barbería, listo para confirmar.',
  },
]
