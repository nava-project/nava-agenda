package httpapi

import (
	"net/http"
	"time"
)

// read devuelve la cookie de sesión de la solicitud: la del nombre actual y,
// solo si falta, la del nombre anterior a DEC-183 (LegacyName). Ninguna de las
// dos se interpreta aquí; la forma y el token los validan el middleware y el
// servicio igual para ambas.
func (c CookieConfig) read(r *http.Request) (*http.Cookie, error) {
	ck, err := r.Cookie(c.Name)
	if err == nil || c.LegacyName == "" {
		return ck, err
	}
	return r.Cookie(c.LegacyName)
}

// write emite la cookie de sesión con el nombre actual y, si la solicitud traía
// la del nombre anterior, la borra: tras iniciar o renovar una sesión el
// navegador queda solo con la nueva.
func (c CookieConfig) write(w http.ResponseWriter, r *http.Request, value string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     c.Name,
		Value:    value,
		Path:     c.Path,
		Expires:  expires,
		HttpOnly: true,
		Secure:   c.Secure,
		SameSite: c.SameSite,
	})
	if c.LegacyName == "" {
		return
	}
	if _, err := r.Cookie(c.LegacyName); err == nil {
		c.expire(w, c.LegacyName)
	}
}

// clear borra la cookie de sesión con los dos nombres (cierre de sesión), con
// los MISMOS atributos con que se emitió (HU-005).
func (c CookieConfig) clear(w http.ResponseWriter) {
	c.expire(w, c.Name)
	if c.LegacyName != "" {
		c.expire(w, c.LegacyName)
	}
}

func (c CookieConfig) expire(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     c.Path,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   c.Secure,
		SameSite: c.SameSite,
	})
}
