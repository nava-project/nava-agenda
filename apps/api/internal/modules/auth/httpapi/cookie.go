package httpapi

import (
	"net/http"
	"time"
)

// read devuelve la cookie de sesión de la solicitud. No la interpreta: la forma y
// el token los validan el middleware y el servicio.
func (c CookieConfig) read(r *http.Request) (*http.Cookie, error) {
	return r.Cookie(c.Name)
}

// write emite la cookie de sesión.
func (c CookieConfig) write(w http.ResponseWriter, _ *http.Request, value string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     c.Name,
		Value:    value,
		Path:     c.Path,
		Expires:  expires,
		HttpOnly: true,
		Secure:   c.Secure,
		SameSite: c.SameSite,
	})
}

// clear borra la cookie de sesión (cierre de sesión) con los MISMOS atributos con
// que se emitió (HU-005).
func (c CookieConfig) clear(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     c.Name,
		Value:    "",
		Path:     c.Path,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   c.Secure,
		SameSite: c.SameSite,
	})
}
