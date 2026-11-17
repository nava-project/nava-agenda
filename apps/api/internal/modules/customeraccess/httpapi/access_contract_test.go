package httpapi_test

import (
	"reflect"
	"testing"

	"system-barbershop/internal/modules/customeraccess/httpapi"
)

// HU-105: los DTO del acceso con código son exactamente los del contrato y las
// dos operaciones declaran sus respuestas sin sesión.
func TestContract_AccessSchemasMatchDTOs(t *testing.T) {
	for _, tc := range []struct {
		name, file string
		dto        any
	}{
		{"solicitud de código", "CustomerAccessChallengeRequest", httpapi.AccessChallengeRequest{}},
		{"respuesta de solicitud", "CustomerAccessChallengeResponse", httpapi.AccessChallengeResponse{}},
		{"verificación", "CustomerAccessVerifyRequest", httpapi.AccessVerifyRequest{}},
		{"turno con acceso", "CustomerAccessAppointment", httpapi.AccessAppointmentResponse{}},
		{"respuesta de verificación", "CustomerAccessVerifyResponse", httpapi.AccessVerifyResponse{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			schema := loadYAML[contractSchema](t, "api/openapi/components/schemas/"+tc.file+".yaml")
			if got, want := jsonFields(t, tc.dto), schemaProps(schema); !reflect.DeepEqual(got, want) {
				t.Fatalf("DTO %v != OpenAPI %v", got, want)
			}
			if schema.AdditionalProperties != false {
				t.Fatal("el esquema debe ser cerrado (additionalProperties: false)")
			}
			if len(schema.Required) != len(schema.Properties) {
				t.Fatalf("todos los campos son obligatorios en el contrato: %v de %d", schema.Required, len(schema.Properties))
			}
		})
	}
}

func TestContract_AccessOperations_DeclareEveryStatusAndNoSession(t *testing.T) {
	ops := loadYAML[map[string]struct {
		Post struct {
			OperationID string         `yaml:"operationId"`
			Security    []any          `yaml:"security"`
			Responses   map[string]any `yaml:"responses"`
		} `yaml:"post"`
	}](t, "api/openapi/paths/customer-appointments.yaml")

	for path, want := range map[string]struct {
		id       string
		statuses []string
	}{
		"/public/barbershops/{slug}/customer-access/challenge": {"requestCustomerAccessCode", []string{"202", "400", "404", "422", "429", "500"}},
		"/public/barbershops/{slug}/customer-access/verify":    {"verifyCustomerAccessCode", []string{"200", "400", "401", "404", "422", "500"}},
	} {
		op, ok := ops[path]
		if !ok {
			t.Fatalf("falta %s", path)
		}
		if op.Post.OperationID != want.id {
			t.Errorf("%s: operationId = %q, want %q", path, op.Post.OperationID, want.id)
		}
		if len(op.Post.Security) != 0 {
			t.Errorf("%s: security debe ser [] (sin sesión): %v", path, op.Post.Security)
		}
		for _, status := range want.statuses {
			if _, ok := op.Post.Responses[status]; !ok {
				t.Errorf("%s: falta la respuesta %s", path, status)
			}
		}
	}
}
