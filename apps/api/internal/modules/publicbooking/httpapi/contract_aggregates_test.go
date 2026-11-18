// Pruebas de contrato de los agregados públicos de solo lectura (DEC-162):
// comparan los DTO reales y las rutas contra el OpenAPI fuente, con el mismo
// criterio que contract_test.go (sin Node/Redocly: se lee el YAML fuente).
package httpapi_test

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"nava-agenda/internal/modules/publicbooking/httpapi"
)

// jsonFieldNames devuelve los nombres JSON de los campos exportados de v.
func jsonFieldNames(v any) []string {
	t := reflect.TypeOf(v)
	names := make([]string, 0, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		tag := strings.Split(t.Field(i).Tag.Get("json"), ",")[0]
		if tag != "" && tag != "-" {
			names = append(names, tag)
		}
	}
	sort.Strings(names)
	return names
}

func assertSchemaMatchesDTO(t *testing.T, schemaPath string, dto any) {
	t.Helper()
	schema := loadYAML[schemaDoc](t, schemaPath)

	got := make([]string, 0, len(schema.Properties))
	for name := range schema.Properties {
		got = append(got, name)
	}
	sort.Strings(got)
	if want := jsonFieldNames(dto); !reflect.DeepEqual(got, want) {
		t.Fatalf("%s declara %v, el DTO serializa %v", schemaPath, got, want)
	}

	required := append([]string(nil), schema.Required...)
	sort.Strings(required)
	if !reflect.DeepEqual(required, got) {
		t.Fatalf("%s: todos los campos deben ser obligatorios (siempre presentes); required=%v propiedades=%v", schemaPath, required, got)
	}
}

func TestContract_AggregateSchemas_MatchDTOFields(t *testing.T) {
	tests := map[string]any{
		"api/openapi/components/schemas/PublicProfessionalServicesResponse.yaml":     httpapi.PublicProfessionalServicesResponse{},
		"api/openapi/components/schemas/PublicProfessionalServicesListResponse.yaml": httpapi.PublicProfessionalServicesListResponse{},
		"api/openapi/components/schemas/ProfessionalAvailabilitySlotResponse.yaml":   httpapi.ProfessionalAvailabilitySlotResponse{},
		"api/openapi/components/schemas/ServiceAvailabilityResponse.yaml":            httpapi.ServiceAvailabilityResponse{},
	}
	for path, dto := range tests {
		t.Run(path, func(t *testing.T) { assertSchemaMatchesDTO(t, path, dto) })
	}
}

type aggregatePathsFile struct {
	Professionals struct {
		Get operation `yaml:"get"`
	} `yaml:"/public/businesses/{slug}/professionals"`
	Availability struct {
		Get operation `yaml:"get"`
	} `yaml:"/public/businesses/{slug}/services/{serviceId}/availability"`
}

func assertPublicReadOperation(t *testing.T, op operation, wantID string, wantParams []string) {
	t.Helper()
	if op.OperationID != wantID {
		t.Errorf("operationId = %q, want %q", op.OperationID, wantID)
	}
	// security: [] explícito = operación pública, sin sesión.
	if op.Security == nil || len(op.Security) != 0 {
		t.Errorf("%s debe declarar security: [] (pública), got %v", wantID, op.Security)
	}
	var params []string
	for _, p := range op.Parameters {
		if p.In != "path" || !p.Required {
			t.Errorf("%s: parámetro %q debe ser path y obligatorio", wantID, p.Name)
		}
		params = append(params, p.Name)
	}
	if !reflect.DeepEqual(params, wantParams) {
		t.Errorf("%s: parámetros %v, want %v (ningún businessId del cliente)", wantID, params, wantParams)
	}
	// Exactamente lo que los handlers producen: 200, 404 uniforme y 500;
	// nunca 401 (sin sesión) ni 400/422 (sin cuerpo ni query).
	wantStatuses := []string{"200", "404", "500"}
	for _, s := range wantStatuses {
		if _, ok := op.Responses[s]; !ok {
			t.Errorf("%s no documenta la respuesta %s", wantID, s)
		}
	}
	if len(op.Responses) != len(wantStatuses) {
		t.Errorf("%s documenta %d respuestas, se esperaban %v", wantID, len(op.Responses), wantStatuses)
	}
}

func TestContract_AggregateOperations_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[aggregatePathsFile](t, "api/openapi/paths/public-booking.yaml")

	assertPublicReadOperation(t, doc.Professionals.Get, "listPublicProfessionalsWithServices", []string{"slug"})
	assertPublicReadOperation(t, doc.Availability.Get, "listPublicServiceAvailability", []string{"slug", "serviceId"})
}

func TestContract_OpenAPIYAML_RegistersAggregatePaths(t *testing.T) {
	type pathsDoc struct {
		Paths map[string]any `yaml:"paths"`
	}
	doc := loadYAML[pathsDoc](t, "api/openapi/openapi.yaml")

	for _, p := range []string{
		"/public/businesses/{slug}/professionals",
		"/public/businesses/{slug}/services/{serviceId}/availability",
		// Las operaciones existentes siguen registradas (compatibilidad).
		"/public/businesses/{slug}/services/{serviceId}/professionals",
		"/public/businesses/{slug}/services/{serviceId}/professionals/{professionalId}/availability",
	} {
		if _, ok := doc.Paths[p]; !ok {
			t.Errorf("openapi.yaml no registra %s", p)
		}
	}
}
