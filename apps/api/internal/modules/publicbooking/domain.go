package publicbooking

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"nava-agenda/internal/platform/apperr"
)

// BusinessProfile es la representación pública mínima de un negocio
// habilitada (HU-090, CA-090-01, CA-090-04): nombre, zona horaria IANA y
// contacto público opcional y vocabulario del negocio (DEC-119). Nunca incluye un identificador interno, el
// slug mismo, ni ningún otro dato de configuración privada.
type BusinessProfile struct {
	Name         string
	Timezone     string
	ContactEmail *string
	ContactPhone *string
	Vocabulary   Vocabulary
	// Location es nil salvo que el negocio muestre un local (DEC-130): el
	// interruptor activo Y coordenadas guardadas. Con cualquier otra
	// combinación es nil y la reserva pública no pinta ninguna sección.
	Location *Location
	// OffersHomeService indica que el negocio ofrece atender a domicilio
	// (DEC-131, HU-103): la reserva pública solo pide la modalidad cuando es true.
	OffersHomeService bool
	// BrandAccent es la clave del color de acento que el negocio eligió en
	// Configuración (DEC-110); la reserva pública la usa para pintar su enlace
	// (DEC-171). Siempre es una clave de business_brand_accent_ck.
	BrandAccent string
	// GooglePlaceID es la ficha de Google del negocio (DEC-129, HU-101), nil
	// sin ficha. Es solo para el servidor: el perfil público nunca lo expone, el
	// navegador recibe únicamente lo que Google devuelve ya recortado.
	GooglePlaceID *string
	// OpeningHours es el horario de atención del local (HU-107, DEC-182),
	// ordenado por día y apertura; vacío si el negocio no lo configuró.
	OpeningHours []OpeningSegment
	// ClosedOnHolidays indica que el local cierra los festivos colombianos.
	ClosedOnHolidays bool
	// Today es lo que rige hoy con el festivo aplicado; nil sin horario. Lo
	// calcula Service.ResolveBusiness, no el repositorio.
	Today *OpeningToday
}

// OpeningSegment es un tramo `[Opens, Closes)` del horario del local, en
// minutos desde medianoche de la hora civil del negocio; Closes puede ser
// 1440 (24:00). Weekday es ISO: 1 = lunes … 7 = domingo. Este paquete no
// importa shops (CA-002-06), así que repite su propia forma mínima.
type OpeningSegment struct {
	Weekday int
	Opens   int
	Closes  int
}

// OpeningToday es el horario de hoy en la fecha civil del negocio: los
// tramos de su día de la semana, o ninguno si es festivo y el local cierra
// los festivos (DEC-182).
type OpeningToday struct {
	// Date es la fecha civil de hoy en la zona del negocio (hora 00:00 UTC).
	Date    time.Time
	Weekday int
	// Holiday es el nombre del festivo colombiano de hoy; nil si no lo es.
	Holiday *string
	// Hours son los tramos de hoy; vacío si hoy cierra.
	Hours []OpeningSegment
}

// HolidayLookup dice si una fecha civil es festivo y cuál. La raíz de
// composición inyecta el calendario colombiano de schedule; este paquete no
// lo importa.
type HolidayLookup func(date time.Time) (name string, ok bool)

// TodayOpening calcula lo que rige en now según el horario semanal, en la
// zona loc. Devuelve nil si no hay horario configurado: no saberlo no es lo
// mismo que estar cerrado.
func TodayOpening(segments []OpeningSegment, closedOnHolidays bool, now time.Time, loc *time.Location, holiday HolidayLookup) *OpeningToday {
	if len(segments) == 0 {
		return nil
	}
	local := now.In(loc)
	date := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	today := &OpeningToday{Date: date, Weekday: (int(local.Weekday())+6)%7 + 1, Hours: []OpeningSegment{}}
	if holiday != nil {
		if name, ok := holiday(date); ok {
			today.Holiday = &name
			if closedOnHolidays {
				return today
			}
		}
	}
	for _, seg := range segments {
		if seg.Weekday == today.Weekday {
			today.Hours = append(today.Hours, seg)
		}
	}
	return today
}

// Location es la ubicación física que la reserva pública muestra (DEC-130,
// HU-102): la dirección en texto y las coordenadas ya geocodificadas con las
// que el navegador centra el mapa. Este paquete no importa shops (CA-002-06),
// así que repite su propia forma mínima.
type Location struct {
	Address   string
	Latitude  float64
	Longitude float64
}

// Vocabulary es la palabra con la que el negocio llama a su negocio y a su
// profesional (DEC-110, DEC-119), con el plural del profesional y el género
// gramatical de ambas (`masculine` o `feminine`) para que la interfaz pública
// concuerde. Es un subconjunto de shops.Brand sin acento ni perfil del panel;
// este paquete no importa shops (CA-002-06), así que repite su propia forma
// mínima. La base garantiza forma y largo (business_*_term_ck); una
// negocio que nunca lo configuró tiene los valores iniciales.
type Vocabulary struct {
	BusinessTerm           string
	BusinessTermGender     string
	ProfessionalTerm       string
	ProfessionalTermPlural string
	ProfessionalTermGender string
}

// MaxSlugLength acota la longitud aceptada del identificador antes de
// consultar la base de datos: cualquier valor más largo se rechaza de
// inmediato con la misma respuesta uniforme que un slug desconocido
// (CA-090-02), sin gastar una consulta. Igual a shops.SlugMaxLength
// (business_public_slug_ck): ningún slug generado supera ese largo, así
// que uno más largo nunca puede coincidir.
const MaxSlugLength = 40

// PublicService es la proyección pública mínima de un servicio ofrecido por
// el negocio resuelta (HU-091, CA-091-01): nombre, descripción, duración,
// precio y moneda. Nunca isActive, deactivatedAt, createdAt, updatedAt ni
// ningún otro dato de auditoría o ciclo de vida -esos campos son alcance
// exclusivo de catalog (HU-022/HU-024); el núcleo de publicbooking no
// importa ese paquete (CA-002-06), así que repite su propia proyección
// mínima en vez de reutilizar catalog.Service.
type PublicService struct {
	ID              string
	Name            string
	Description     *string
	DurationMinutes int
	PriceCents      int64
	Currency        string
}

// FormatServicePriceCOP formatea cents como el string decimal de dos
// dígitos que el contrato público expone en `price`. Duplica
// catalog.FormatPriceCOP a propósito (mismo criterio de CA-002-06 que
// centsFromNumeric en publicbooking/postgres): el núcleo de publicbooking
// no importa catalog.
func FormatServicePriceCOP(cents int64) string {
	whole := cents / 100
	frac := cents % 100
	return fmt.Sprintf("%d.%02d", whole, frac)
}

// Límites de paginación del catálogo público (HU-091), mismo criterio
// técnico que catalog.DefaultListLimit/MinListLimit/MaxListLimit: la
// colección no tiene un máximo de negocio de servicios por negocio.
const (
	DefaultServiceListLimit = 20
	MinServiceListLimit     = 1
	MaxServiceListLimit     = 50
)

// PublicServiceListResult es una página de PublicService ya ordenada de
// forma estable (created_at, id). NextCursor es "" cuando esta página es la
// última.
type PublicServiceListResult struct {
	Items      []PublicService
	NextCursor string
}

// ServiceCursor es la posición decodificada de una página del catálogo
// público, mismo patrón que catalog.Cursor (el núcleo de publicbooking no
// importa catalog, CA-002-06: duplicación pequeña y clara preferible a una
// abstracción cruzada entre módulos, docs/03-desarrollo/
// estandar-backend-go.md §5.23).
type ServiceCursor struct {
	CreatedAt time.Time
	ID        string
}

type serviceCursorWire struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

// EncodeServiceCursor produce el valor opaco que la respuesta expone como
// `nextCursor`.
func EncodeServiceCursor(c ServiceCursor) string {
	raw, err := json.Marshal(serviceCursorWire{CreatedAt: c.CreatedAt, ID: c.ID})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// DecodeServiceCursor invierte EncodeServiceCursor. Cualquier valor que no
// haya salido de EncodeServiceCursor se rechaza como entrada de cliente
// inválida, nunca como error interno.
func DecodeServiceCursor(raw string) (ServiceCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return ServiceCursor{}, apperr.Invalid("el parámetro cursor tiene un formato inválido")
	}
	var w serviceCursorWire
	if err := json.Unmarshal(decoded, &w); err != nil {
		return ServiceCursor{}, apperr.Invalid("el parámetro cursor tiene un formato inválido")
	}
	if w.ID == "" || w.CreatedAt.IsZero() {
		return ServiceCursor{}, apperr.Invalid("el parámetro cursor tiene un formato inválido")
	}
	return ServiceCursor{CreatedAt: w.CreatedAt, ID: w.ID}, nil
}

// PublicProfessional es la proyección pública de un profesional con asignación vigente
// al servicio activo resuelto (HU-092, CA-092-02): ID, nombre completo y, por
// DEC-127, su descripción opcional y la versión de su fotografía opcional
// (nil mientras no tiene; el cliente pide los bytes por separado). Nunca
// preferencia ni ningún otro campo de staff.Professional. El núcleo de publicbooking
// no importa staff (CA-002-06, mismo criterio que PublicService frente a
// catalog.Service): repite su propia proyección en vez de una dependencia
// cruzada entre módulos.
type PublicProfessional struct {
	ID             string
	FullName       string
	Description    *string
	PhotoUpdatedAt *time.Time
	// Rating es el promedio de 1 decimal de las reseñas no ocultas y RatingCount
	// su total (DEC-128 §5); Rating es nil sin ninguna reseña visible.
	Rating      *float64
	RatingCount int
}

// PublicProfessionalServices es la proyección pública agregada de un profesional
// elegible para la reserva: id, nombre y los servicios ACTIVOS que tiene
// asignados (agregado de solo lectura para clientes que, como el agente
// Odin, necesitan el mapa profesional-servicio completo en una sola lectura en
// vez de una por servicio, DEC-162). Mismos campos y saneamiento que
// PublicProfessional para id y nombre; nunca descripción, fotografía, reseñas ni
// ningún otro campo de staff.Professional.
type PublicProfessionalServices struct {
	ID         string
	FullName   string
	ServiceIDs []string
}

// PublicProfessionalServicesListResult es la lista completa (sin paginar, mismo
// criterio que PublicProfessionalListResult) de profesionales con al menos una
// asignación vigente a un servicio activo, ordenada de forma estable
// (created_at del profesional, id) para que dos lecturas sin cambios devuelvan
// exactamente el mismo cuerpo.
type PublicProfessionalServicesListResult struct {
	Items []PublicProfessionalServices
}

// PublicProfessionalPhoto es la fotografía pública de un profesional (DEC-127): el
// mismo contenido que `professional_photo`, entregado solo si el profesional es
// elegible en la reserva pública.
type PublicProfessionalPhoto struct {
	ContentType string
	Data        []byte
	UpdatedAt   time.Time
}

// PublicProfessionalListResult es la lista completa (sin paginar: HU-092 no
// documenta un tope de negocio de profesionales por servicio, y el volumen
// esperado -profesionales de un solo negocio- nunca justifica cursor) de
// profesionales elegibles, ya ordenada de forma estable (created_at de la
// asignación, id del profesional) para que la matriz 0/1/N (CA-092-01) sea
// determinista entre llamadas.
type PublicProfessionalListResult struct {
	Items []PublicProfessional
}

// serviceIDPattern es la misma forma canónica 8-4-4-4-12 que
// catalog.LooksLikeServiceID exige (el núcleo de publicbooking no puede
// importar catalog, CA-002-06, así que se repite la validación aquí, mismo
// criterio que catalog.professionalIDPattern frente a staff.LooksLikeProfessionalID).
var serviceIDPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

// LooksLikePublicServiceID informa si id tiene la forma de un UUID válido.
// Un identificador que no la tiene no puede corresponder a ninguna fila
// real: CA-092-03 lo trata igual que un servicio ajeno, inexistente o ya no
// asignado -lista vacía, nunca un error que distinga la causa- así que se
// descarta ANTES de tocar la base, con el mismo tiempo de respuesta que
// cualquier otro caso de esa misma familia.
func LooksLikePublicServiceID(id string) bool {
	return serviceIDPattern.MatchString(id)
}

// professionalIDPattern es la misma forma canónica 8-4-4-4-12 que
// staff.LooksLikeProfessionalID exige (el núcleo de publicbooking no puede
// importar staff, CA-002-06: se repite la validación aquí, mismo criterio
// que serviceIDPattern frente a catalog.LooksLikeServiceID).
var professionalIDPattern = serviceIDPattern

// LooksLikePublicProfessionalID informa si id tiene la forma de un UUID válido
// (HU-094). Un identificador que no la tiene no puede corresponder a ningún
// profesional real: se trata igual que un profesional ajeno, inexistente o sin
// asignación vigente -disponibilidad vacía, nunca un error que distinga la
// causa (mismo criterio que CA-092-03).
func LooksLikePublicProfessionalID(id string) bool {
	return professionalIDPattern.MatchString(id)
}

// AvailabilitySlot es un inicio público válido ya resuelto (HU-094,
// CA-094-01): el instante absoluto en que puede empezar el servicio
// completo elegido.
type AvailabilitySlot struct {
	StartsAt time.Time
}

// AvailabilityResult es la respuesta completa de HU-094: los inicios
// válidos, ya ordenados de forma estable (cronológica), junto con el
// contexto mínimo que el cliente necesita para interpretarlos sin
// ambigüedad (RN-DIS-07: zona del negocio, nunca la del dispositivo).
type AvailabilityResult struct {
	Slots           []AvailabilitySlot
	DurationMinutes int
	Timezone        string
	SlotGridMinutes int
}

// ProfessionalAvailabilitySlot es un inicio público válido atribuido a un profesional
// concreto: la unidad del agregado de disponibilidad por servicio (DEC-162).
// Equivale a AvailabilitySlot de HU-094 más el profesional al que pertenece.
type ProfessionalAvailabilitySlot struct {
	ProfessionalID string
	StartsAt       time.Time
}

// ServiceAvailabilityResult es la respuesta del agregado de disponibilidad
// por servicio (DEC-162): los inicios válidos de TODOS los profesionales
// elegibles del servicio, ordenados por (StartsAt, ProfessionalID), con el mismo
// contexto de interpretación que AvailabilityResult. Es vacío (Slots sin
// elementos y el resto en cero) cuando el servicio no existe, es ajeno,
// está inactivo o no tiene ningún profesional con asignación vigente: la causa
// no se distingue (mismo criterio que CA-092-03).
type ServiceAvailabilityResult struct {
	Slots           []ProfessionalAvailabilitySlot
	DurationMinutes int
	Timezone        string
	SlotGridMinutes int
}
