package main

import "system-barbershop/internal/modules/access"

// privatePrefix es el prefijo del subrouter privado (httpserver.NewRouter).
const privatePrefix = "/api/v1/private"

// privateAccessPolicy clasifica TODAS las rutas privadas para el empleado
// restringido (DEC-173). Quien no es empleado restringido no pasa por aquí.
// TestPrivateAccessPolicy_ClassifiesEveryPrivateRoute falla si una ruta
// registrada falta en esta tabla, así que una ruta nueva no puede quedar
// abierta por olvido.
//
// Criterio: lo de su propio barbero (horarios, excepciones, bloqueos, agenda y
// turnos, servicios que ofrece, ventana propia, perfil y foto) es OwnBarber /
// OwnAppointment; la configuración de la barbería es DenyRestricted; las
// lecturas que el panel necesita y lo personal (sesión, Google Calendar) es
// Open; las listas de varios barberos son Filtered.
var privateAccessPolicy = []access.Entry{
	// Sesión.
	{Method: "POST", Pattern: "/auth/logout", Rule: access.Open},
	{Method: "GET", Pattern: "/auth/session", Rule: access.Open},

	// Configuración de la barbería: se lee (zona horaria, marca, vocabulario,
	// ventana heredada, enlace público) pero no se cambia.
	{Method: "GET", Pattern: "/settings/business", Rule: access.Open},
	{Method: "PATCH", Pattern: "/settings/business", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/settings/booking-policy", Rule: access.Open},
	{Method: "PUT", Pattern: "/settings/booking-policy", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/settings/booking-policy/professionals", Rule: access.Filtered},
	{Method: "PUT", Pattern: "/settings/booking-policy/professionals/{professionalId}", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/settings/booking-policy/professionals/{professionalId}", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/settings/brand", Rule: access.Open},
	{Method: "PATCH", Pattern: "/settings/brand", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/settings/login-otp", Rule: access.DenyRestricted},
	{Method: "PATCH", Pattern: "/settings/login-otp", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/settings/reminders", Rule: access.DenyRestricted},
	{Method: "PATCH", Pattern: "/settings/reminders", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/settings/opening-hours", Rule: access.DenyRestricted},
	{Method: "PUT", Pattern: "/settings/opening-hours", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/settings/public-link", Rule: access.Open},

	// Google Calendar: personal, resuelto en el servidor con su propio vínculo.
	{Method: "GET", Pattern: "/integrations/google-calendar", Rule: access.Open},
	{Method: "PATCH", Pattern: "/integrations/google-calendar", Rule: access.Open},
	{Method: "DELETE", Pattern: "/integrations/google-calendar", Rule: access.Open},
	{Method: "POST", Pattern: "/integrations/google-calendar/connect", Rule: access.Open},
	{Method: "POST", Pattern: "/integrations/google-calendar/sync", Rule: access.Open},
	{Method: "POST", Pattern: "/integrations/google-calendar/callback", Rule: access.Open},

	// Su vínculo con un barbero lo fija el alta, igual que sus roles (DEC-134):
	// si pudiera cambiarlo, se saltaría todas las demás reglas.
	{Method: "GET", Pattern: "/me/professional", Rule: access.Open},
	{Method: "PUT", Pattern: "/me/professional", Rule: access.DenyRestricted},
	{Method: "DELETE", Pattern: "/me/professional", Rule: access.DenyRestricted},

	// Equipo: ve y edita solo su perfil; no da de alta barberos.
	{Method: "GET", Pattern: "/professionals", Rule: access.Filtered},
	{Method: "POST", Pattern: "/professionals", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/professionals/{professionalId}", Rule: access.OwnBarber},
	{Method: "PATCH", Pattern: "/professionals/{professionalId}", Rule: access.OwnBarber},
	{Method: "PUT", Pattern: "/professionals/{professionalId}/photo", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/photo", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/photo", Rule: access.OwnBarber},

	// Catálogo de la barbería: lo lee (nuevo turno, sus servicios) pero no lo cambia.
	{Method: "GET", Pattern: "/services", Rule: access.Open},
	{Method: "POST", Pattern: "/services", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/services/{serviceId}", Rule: access.Open},
	{Method: "PATCH", Pattern: "/services/{serviceId}", Rule: access.DenyRestricted},
	{Method: "GET", Pattern: "/services/{serviceId}/deactivation-impact", Rule: access.DenyRestricted},
	{Method: "POST", Pattern: "/services/{serviceId}/deactivate", Rule: access.DenyRestricted},
	{Method: "POST", Pattern: "/services/{serviceId}/reactivate", Rule: access.DenyRestricted},

	// Qué servicios del catálogo ofrece él.
	{Method: "GET", Pattern: "/professionals/{professionalId}/services", Rule: access.OwnBarber},
	{Method: "PUT", Pattern: "/professionals/{professionalId}/services/{serviceId}", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/services/{serviceId}", Rule: access.OwnBarber},

	// Su jornada, festivos y excepciones.
	{Method: "GET", Pattern: "/professionals/{professionalId}/working-hours", Rule: access.OwnBarber},
	{Method: "POST", Pattern: "/professionals/{professionalId}/working-hours", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/working-hours/{workingHourId}", Rule: access.OwnBarber},
	{Method: "PATCH", Pattern: "/professionals/{professionalId}/working-hours/{workingHourId}", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/working-hours/{workingHourId}", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/holiday-calendar", Rule: access.OwnBarber},
	{Method: "PATCH", Pattern: "/professionals/{professionalId}/holiday-calendar", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/schedule-exceptions", Rule: access.OwnBarber},
	{Method: "POST", Pattern: "/professionals/{professionalId}/schedule-exceptions", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/schedule-exceptions/{exceptionId}", Rule: access.OwnBarber},
	{Method: "PATCH", Pattern: "/professionals/{professionalId}/schedule-exceptions/{exceptionId}", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/schedule-exceptions/{exceptionId}", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/schedule/colombian-holidays", Rule: access.Open},

	// Sus bloqueos.
	{Method: "GET", Pattern: "/professionals/{professionalId}/time-blocks/effective", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/time-blocks", Rule: access.OwnBarber},
	{Method: "POST", Pattern: "/professionals/{professionalId}/time-blocks", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/time-blocks/{blockId}", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/time-blocks/{blockId}", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/time-block-series", Rule: access.OwnBarber},
	{Method: "POST", Pattern: "/professionals/{professionalId}/time-block-series", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/professionals/{professionalId}/time-block-series/{seriesId}", Rule: access.OwnBarber},
	{Method: "PATCH", Pattern: "/professionals/{professionalId}/time-block-series/{seriesId}", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/time-block-series/{seriesId}", Rule: access.OwnBarber},
	{Method: "POST", Pattern: "/professionals/{professionalId}/time-block-series/{seriesId}/dates", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/time-block-series/{seriesId}/dates/{blockDate}", Rule: access.OwnBarber},
	{Method: "POST", Pattern: "/professionals/{professionalId}/time-block-series/{seriesId}/exceptions", Rule: access.OwnBarber},
	{Method: "DELETE", Pattern: "/professionals/{professionalId}/time-block-series/{seriesId}/exceptions/{excludedDate}", Rule: access.OwnBarber},

	// Reseñas: ve las suyas; moderarlas es de la barbería.
	{Method: "GET", Pattern: "/professionals/{professionalId}/reviews", Rule: access.OwnBarber},
	{Method: "PATCH", Pattern: "/professionals/{professionalId}/reviews/{reviewId}", Rule: access.DenyRestricted},

	// Su agenda y sus turnos.
	{Method: "POST", Pattern: "/appointments", Rule: access.OwnBarberInBody},
	{Method: "GET", Pattern: "/professionals/{professionalId}/appointments/daily-agenda", Rule: access.OwnBarber},
	{Method: "GET", Pattern: "/appointments/{appointmentId}", Rule: access.OwnAppointment},
	{Method: "GET", Pattern: "/appointments/{appointmentId}/history", Rule: access.OwnAppointment},
	{Method: "POST", Pattern: "/appointments/{appointmentId}/reschedule", Rule: access.OwnAppointment},
	{Method: "POST", Pattern: "/appointments/{appointmentId}/cancel", Rule: access.OwnAppointment},
	{Method: "POST", Pattern: "/appointments/{appointmentId}/complete", Rule: access.OwnAppointment},
	{Method: "POST", Pattern: "/appointments/{appointmentId}/no-show", Rule: access.OwnAppointment},
	{Method: "POST", Pattern: "/appointments/{appointmentId}/correct-status", Rule: access.OwnAppointment},
}
