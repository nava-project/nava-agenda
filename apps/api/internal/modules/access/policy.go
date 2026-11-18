package access

import (
	"fmt"
	"regexp"
	"strings"
)

// Rule es lo que una ruta privada exige al empleado restringido (DEC-173).
// Quien no está restringido nunca pasa por una regla.
type Rule int

const (
	// Open: el empleado puede usarla tal cual (lecturas que el panel necesita,
	// su sesión, su integración personal).
	Open Rule = iota + 1
	// Filtered: la ruta lista recursos de varios profesionales; su handler filtra
	// con ScopeFromContext para devolver solo el del empleado.
	Filtered
	// DenyRestricted: configuración del negocio; 403 para el empleado.
	DenyRestricted
	// OwnProfessional: ruta con {professionalId}; solo su propio profesional (403 si no).
	OwnProfessional
	// OwnProfessionalInBody: el professionalId viaja en el cuerpo JSON (crear turno).
	OwnProfessionalInBody
	// OwnAppointment: ruta con {appointmentId}; un turno de otro profesional
	// responde 404, igual que uno inexistente (no revela datos de clientes).
	OwnAppointment
)

func (r Rule) String() string {
	switch r {
	case Open:
		return "open"
	case Filtered:
		return "filtered"
	case DenyRestricted:
		return "deny"
	case OwnProfessional:
		return "own-professional"
	case OwnProfessionalInBody:
		return "own-professional-body"
	case OwnAppointment:
		return "own-appointment"
	}
	return "unknown"
}

// Entry clasifica una ruta privada: método y patrón chi relativo al prefijo
// privado (p. ej. "/professionals/{professionalId}/photo").
type Entry struct {
	Method  string
	Pattern string
	Rule    Rule
}

type compiledEntry struct {
	Entry
	re     *regexp.Regexp
	params []string
}

// Policy es la tabla de permisos de todas las rutas privadas.
type Policy struct {
	entries []compiledEntry
}

var paramPattern = regexp.MustCompile(`\{([A-Za-z]+)\}`)

// NewPolicy compila la tabla. Un patrón repetido es un error de wiring.
func NewPolicy(entries []Entry) (*Policy, error) {
	seen := map[string]bool{}
	p := &Policy{}
	for _, e := range entries {
		key := e.Method + " " + e.Pattern
		if seen[key] {
			return nil, fmt.Errorf("access: ruta repetida en la tabla de permisos: %s", key)
		}
		seen[key] = true
		// QuoteMeta escapa también las llaves de los parámetros: se restauran y
		// cada {nombre} pasa a ser un segmento capturado.
		quoted := strings.NewReplacer(`\{`, `{`, `\}`, `}`).Replace(regexp.QuoteMeta(e.Pattern))
		expr := paramPattern.ReplaceAllString(quoted, `([^/]+)`)
		var params []string
		for _, m := range paramPattern.FindAllStringSubmatch(e.Pattern, -1) {
			params = append(params, m[1])
		}
		p.entries = append(p.entries, compiledEntry{Entry: e, re: regexp.MustCompile("^" + expr + "$"), params: params})
	}
	return p, nil
}

// Match busca la regla de method+path (path relativo al prefijo privado) y los
// parámetros de la ruta.
func (p *Policy) Match(method, path string) (Rule, map[string]string, bool) {
	for _, e := range p.entries {
		if e.Method != method {
			continue
		}
		m := e.re.FindStringSubmatch(path)
		if m == nil {
			continue
		}
		params := make(map[string]string, len(e.params))
		for i, name := range e.params {
			params[name] = m[i+1]
		}
		return e.Rule, params, true
	}
	return 0, nil, false
}

// Has indica si la tabla clasifica exactamente method+pattern (prueba de
// inventario: toda ruta privada registrada debe estar en la tabla).
func (p *Policy) Has(method, pattern string) bool {
	for _, e := range p.entries {
		if e.Method == method && e.Pattern == pattern {
			return true
		}
	}
	return false
}

// Entries devuelve la tabla tal como se declaró.
func (p *Policy) Entries() []Entry {
	out := make([]Entry, len(p.entries))
	for i, e := range p.entries {
		out[i] = e.Entry
	}
	return out
}
