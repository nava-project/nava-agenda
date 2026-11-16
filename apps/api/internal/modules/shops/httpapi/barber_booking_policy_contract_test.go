// Pruebas de contrato de DEC-169: el DTO real y las operaciones contra el
// OpenAPI fuente (no el bundle de dist/).
package httpapi_test

import (
	"encoding/json"
	"sort"
	"testing"

	"system-barbershop/internal/modules/shops/httpapi"
)

type barberBookingPolicyPathFile struct {
	List struct {
		Get operation `yaml:"get"`
	} `yaml:"/private/settings/booking-policy/barbers"`
	Item struct {
		Put    operation `yaml:"put"`
		Delete operation `yaml:"delete"`
	} `yaml:"/private/settings/booking-policy/barbers/{barberId}"`
}

func jsonKeys(t *testing.T, v any) []string {
	t.Helper()
	raw, _ := json.Marshal(v)
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func TestContract_BarberBookingPolicySchemas_MatchDTOFields(t *testing.T) {
	requireProps(t, loadYAML[schemaDoc](t, "api/openapi/components/schemas/BarberBookingPolicyResponse.yaml"),
		jsonKeys(t, httpapi.BarberBookingPolicyResponse{}))
	requireProps(t, loadYAML[schemaDoc](t, "api/openapi/components/schemas/PutBarberBookingPolicyRequest.yaml"),
		jsonKeys(t, httpapi.PutBarberBookingPolicyRequest{}))
	requireProps(t, loadYAML[schemaDoc](t, "api/openapi/components/schemas/BarberBookingPolicyListResponse.yaml"),
		[]string{"items"})
}

func TestContract_BarberBookingPolicyOperations_SecurityAndResponses(t *testing.T) {
	file := loadYAML[barberBookingPolicyPathFile](t, "api/openapi/paths/settings.yaml")
	cases := []struct {
		op    operation
		id    string
		codes []string
	}{
		{file.List.Get, "listBarberBookingPolicies", []string{"200", "401", "500"}},
		{file.Item.Put, "putBarberBookingPolicy", []string{"200", "400", "401", "403", "404", "422", "500"}},
		{file.Item.Delete, "deleteBarberBookingPolicy", []string{"204", "401", "403", "404", "500"}},
	}
	for _, tc := range cases {
		if tc.op.OperationID != tc.id {
			t.Errorf("expected operationId %q, got %q", tc.id, tc.op.OperationID)
		}
		if len(tc.op.Security) != 1 {
			t.Errorf("%s: debe exigir SessionCookie", tc.id)
		}
		if len(tc.op.Responses) != len(tc.codes) {
			t.Errorf("%s: expected responses %v, got %v", tc.id, tc.codes, tc.op.Responses)
		}
		for _, c := range tc.codes {
			if _, ok := tc.op.Responses[c]; !ok {
				t.Errorf("%s: falta la respuesta %s", tc.id, c)
			}
		}
	}
}
