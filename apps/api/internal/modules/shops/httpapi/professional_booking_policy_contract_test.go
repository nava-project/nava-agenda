// Pruebas de contrato de DEC-169: el DTO real y las operaciones contra el
// OpenAPI fuente (no el bundle de dist/).
package httpapi_test

import (
	"encoding/json"
	"sort"
	"testing"

	"nava-agenda/internal/modules/shops/httpapi"
)

type professionalBookingPolicyPathFile struct {
	List struct {
		Get operation `yaml:"get"`
	} `yaml:"/private/settings/booking-policy/professionals"`
	Item struct {
		Put    operation `yaml:"put"`
		Delete operation `yaml:"delete"`
	} `yaml:"/private/settings/booking-policy/professionals/{professionalId}"`
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

func TestContract_ProfessionalBookingPolicySchemas_MatchDTOFields(t *testing.T) {
	requireProps(t, loadYAML[schemaDoc](t, "api/openapi/components/schemas/ProfessionalBookingPolicyResponse.yaml"),
		jsonKeys(t, httpapi.ProfessionalBookingPolicyResponse{}))
	requireProps(t, loadYAML[schemaDoc](t, "api/openapi/components/schemas/PutProfessionalBookingPolicyRequest.yaml"),
		jsonKeys(t, httpapi.PutProfessionalBookingPolicyRequest{}))
	requireProps(t, loadYAML[schemaDoc](t, "api/openapi/components/schemas/ProfessionalBookingPolicyListResponse.yaml"),
		[]string{"items"})
}

func TestContract_ProfessionalBookingPolicyOperations_SecurityAndResponses(t *testing.T) {
	file := loadYAML[professionalBookingPolicyPathFile](t, "api/openapi/paths/settings.yaml")
	cases := []struct {
		op    operation
		id    string
		codes []string
	}{
		{file.List.Get, "listProfessionalBookingPolicies", []string{"200", "401", "500"}},
		{file.Item.Put, "putProfessionalBookingPolicy", []string{"200", "400", "401", "403", "404", "422", "500"}},
		{file.Item.Delete, "deleteProfessionalBookingPolicy", []string{"204", "401", "403", "404", "500"}},
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
