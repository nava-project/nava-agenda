package httpapi_test

import (
	"reflect"
	"testing"

	"nava-agenda/internal/modules/customeraccess/httpapi"
)

// HU-106: los DTO de las rutas de Odin y de la verificación por referencia son
// exactamente los del contrato, y cada operación declara sus respuestas y su
// seguridad.
func TestContract_OdinSchemasMatchDTOs(t *testing.T) {
	for _, tc := range []struct {
		name, file string
		dto        any
		// optional son los campos que el contrato no exige (DEC-181).
		optional []string
	}{
		{"búsqueda", "OdinAppointmentLookupRequest", httpapi.OdinLookupRequest{}, nil},
		{"turno de la búsqueda", "OdinAppointment", httpapi.OdinAppointmentResponse{}, nil},
		{"respuesta de la búsqueda", "OdinAppointmentLookupResponse", httpapi.OdinLookupResponse{}, nil},
		{"solicitud de código", "OdinAccessChallengeRequest", httpapi.OdinChallengeRequest{}, []string{"purpose"}},
		{"respuesta de la solicitud", "OdinAccessChallengeResponse", httpapi.OdinChallengeResponse{}, []string{"accessUrl"}},
		{"verificación por referencia", "CustomerAccessVerifyRefRequest", httpapi.VerifyRefRequest{}, nil},
		{"respuesta de la verificación", "CustomerAccessVerifyRefResponse", httpapi.VerifyRefResponse{}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			schema := loadYAML[contractSchema](t, "api/openapi/components/schemas/"+tc.file+".yaml")
			if got, want := jsonFields(t, tc.dto), schemaProps(schema); !reflect.DeepEqual(got, want) {
				t.Fatalf("DTO %v != OpenAPI %v", got, want)
			}
			if schema.AdditionalProperties != false {
				t.Fatal("el esquema debe ser cerrado (additionalProperties: false)")
			}
			optional := map[string]bool{}
			for _, name := range tc.optional {
				optional[name] = true
			}
			required := map[string]bool{}
			for _, name := range schema.Required {
				required[name] = true
			}
			for name := range schema.Properties {
				if required[name] == optional[name] {
					t.Fatalf("%q: obligatorio=%v, pero se esperaba opcional=%v", name, required[name], optional[name])
				}
			}
		})
	}
}

func TestContract_OdinOperations_DeclareEveryStatusAndTheirSecurity(t *testing.T) {
	type operation struct {
		Post struct {
			OperationID string           `yaml:"operationId"`
			Security    []map[string]any `yaml:"security"`
			Responses   map[string]any   `yaml:"responses"`
		} `yaml:"post"`
	}
	odin := loadYAML[map[string]operation](t, "api/openapi/paths/integrations-odin.yaml")
	public := loadYAML[map[string]operation](t, "api/openapi/paths/customer-appointments.yaml")

	for _, tc := range []struct {
		ops      map[string]operation
		path     string
		id       string
		service  bool
		statuses []string
	}{
		{odin, "/integrations/odin/businesses/{slug}/customer-appointments/lookup", "lookupCustomerAppointmentsForOdin", true, []string{"200", "400", "401", "404", "422", "500"}},
		{odin, "/integrations/odin/businesses/{slug}/customer-access/challenge", "requestCustomerAccessCodeForOdin", true, []string{"201", "400", "401", "404", "409", "422", "429", "500", "503"}},
		{public, "/public/businesses/{slug}/customer-access/verify-ref", "verifyCustomerAccessRef", false, []string{"200", "400", "401", "404", "422", "500"}},
	} {
		op, ok := tc.ops[tc.path]
		if !ok {
			t.Fatalf("falta %s", tc.path)
		}
		if op.Post.OperationID != tc.id {
			t.Errorf("%s: operationId = %q, want %q", tc.path, op.Post.OperationID, tc.id)
		}
		_, hasServiceToken := firstSecurity(op.Post.Security)["OdinServiceToken"]
		if tc.service != hasServiceToken || (!tc.service && len(op.Post.Security) != 0) {
			t.Errorf("%s: security = %v (¿credencial de servicio? %v)", tc.path, op.Post.Security, tc.service)
		}
		for _, status := range tc.statuses {
			if _, ok := op.Post.Responses[status]; !ok {
				t.Errorf("%s: falta la respuesta %s", tc.path, status)
			}
		}
	}
}

func firstSecurity(s []map[string]any) map[string]any {
	if len(s) == 0 {
		return nil
	}
	return s[0]
}
