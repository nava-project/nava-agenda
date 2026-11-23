// Pruebas de contrato de HU-021: comparan los handlers reales contra el
// OpenAPI fuente (api/openapi/paths/staff.yaml y sus schemas), sin depender
// de Node/Redocly (mismo criterio que
// internal/modules/shops/httpapi/contract_test.go): se lee el YAML fuente
// directamente, no el bundle de dist/.
package httpapi_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type schemaDoc struct {
	Properties map[string]any `yaml:"properties"`
	Required   []string       `yaml:"required"`
}

type operation struct {
	OperationID string         `yaml:"operationId"`
	Security    []any          `yaml:"security"`
	Responses   map[string]any `yaml:"responses"`
}

type staffPathsFile struct {
	Collection struct {
		Get  operation `yaml:"get"`
		Post operation `yaml:"post"`
	} `yaml:"/private/professionals"`
	Item struct {
		Get   operation `yaml:"get"`
		Patch operation `yaml:"patch"`
	} `yaml:"/private/professionals/{professionalId}"`
	Photo struct {
		Put    operation `yaml:"put"`
		Get    operation `yaml:"get"`
		Delete operation `yaml:"delete"`
	} `yaml:"/private/professionals/{professionalId}/photo"`
	Me struct {
		Get    operation `yaml:"get"`
		Put    operation `yaml:"put"`
		Delete operation `yaml:"delete"`
	} `yaml:"/private/me/professional"`
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("no se pudo obtener el directorio de trabajo: %v", err)
	}
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "redocly.yaml")); statErr == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("no se encontró redocly.yaml subiendo desde el directorio de la prueba")
		}
		dir = parent
	}
}

func loadYAML[T any](t *testing.T, relPath string) T {
	t.Helper()
	full := filepath.Join(findRepoRoot(t), filepath.FromSlash(relPath))
	raw, err := os.ReadFile(full)
	if err != nil {
		t.Fatalf("no se pudo leer %s: %v", full, err)
	}
	var v T
	if err := yaml.Unmarshal(raw, &v); err != nil {
		t.Fatalf("no se pudo interpretar %s: %v", full, err)
	}
	return v
}

func requireProps(t *testing.T, schema schemaDoc, want []string) {
	t.Helper()
	if len(schema.Properties) != len(want) {
		t.Fatalf("expected %d properties, schema has %d: %v", len(want), len(schema.Properties), schema.Properties)
	}
	for _, prop := range want {
		if _, ok := schema.Properties[prop]; !ok {
			t.Errorf("schema no declara la propiedad %q", prop)
		}
	}
	for _, wantReq := range want {
		found := false
		for _, r := range schema.Required {
			if r == wantReq {
				found = true
			}
		}
		if !found {
			t.Errorf("schema no marca %q como required", wantReq)
		}
	}
}

// requireOptionalProps es requireProps para un esquema con campos opcionales
// (DEC-127: description en las solicitudes de alta y actualización): las
// propiedades de required deben ser obligatorias y las de optional, existir
// sin ser obligatorias.
func requireOptionalProps(t *testing.T, schema schemaDoc, required, optional []string) {
	t.Helper()
	if want := len(required) + len(optional); len(schema.Properties) != want {
		t.Fatalf("expected %d properties, schema has %d: %v", want, len(schema.Properties), schema.Properties)
	}
	isRequired := map[string]bool{}
	for _, r := range schema.Required {
		isRequired[r] = true
	}
	for _, prop := range required {
		if _, ok := schema.Properties[prop]; !ok {
			t.Errorf("schema no declara la propiedad %q", prop)
		}
		if !isRequired[prop] {
			t.Errorf("schema no marca %q como required", prop)
		}
	}
	for _, prop := range optional {
		if _, ok := schema.Properties[prop]; !ok {
			t.Errorf("schema no declara la propiedad opcional %q", prop)
		}
		if isRequired[prop] {
			t.Errorf("schema marca %q como required, pero es opcional (DEC-127)", prop)
		}
	}
}

func requireResponses(t *testing.T, op operation, wantOperationID string, wantStatuses []string) {
	t.Helper()
	if op.OperationID != wantOperationID {
		t.Fatalf("expected operationId %q, got %q", wantOperationID, op.OperationID)
	}
	if len(op.Security) != 1 {
		t.Fatalf("expected exactly one security requirement (SessionCookie), got %v", op.Security)
	}
	for _, s := range wantStatuses {
		if _, ok := op.Responses[s]; !ok {
			t.Errorf("el contrato no documenta la respuesta %s para %s, pero el handler la produce", s, wantOperationID)
		}
	}
	if len(op.Responses) != len(wantStatuses) {
		t.Errorf("%s documenta %d respuestas, se esperaban exactamente %d (%v); revisa que no sobre ni falte una",
			wantOperationID, len(op.Responses), len(wantStatuses), wantStatuses)
	}
}

// --- Schemas -------------------------------------------------------------

// TestContract_ProfessionalResponseSchema_MatchesDTOFields verifica que
// httpapi.ProfessionalResponse (id, fullName, createdAt, updatedAt, photoUpdatedAt,
// description) coincide exactamente con ProfessionalResponse.yaml (CA-021-07: nunca
// active, deletedAt, sortOrder, staffUserId, servicios ni horarios; DEC-104
// añade photoUpdatedAt y DEC-127 description).
func TestContract_ProfessionalResponseSchema_MatchesDTOFields(t *testing.T) {
	schema := loadYAML[schemaDoc](t, "api/openapi/components/schemas/ProfessionalResponse.yaml")
	requireProps(t, schema, []string{"id", "fullName", "createdAt", "updatedAt", "photoUpdatedAt", "description", "rating", "ratingCount"})
}

func TestContract_CreateProfessionalRequestSchema_MatchesDTOFields(t *testing.T) {
	schema := loadYAML[schemaDoc](t, "api/openapi/components/schemas/CreateProfessionalRequest.yaml")
	requireOptionalProps(t, schema, []string{"fullName"}, []string{"description"})
	if _, ok := schema.Properties["businessId"]; ok {
		t.Fatal("el contrato de alta nunca debe declarar businessId")
	}
}

func TestContract_UpdateProfessionalRequestSchema_MatchesDTOFields(t *testing.T) {
	schema := loadYAML[schemaDoc](t, "api/openapi/components/schemas/UpdateProfessionalRequest.yaml")
	requireOptionalProps(t, schema, []string{"fullName"}, []string{"description"})
	for _, forbidden := range []string{"active", "deletedAt", "sortOrder", "staffUserId", "businessId"} {
		if _, ok := schema.Properties[forbidden]; ok {
			t.Fatalf("CA-021-07/DEC-047: el contrato de renombrado nunca debe declarar %q", forbidden)
		}
	}
}

func TestContract_ProfessionalListResponseSchema_HasItemsAndNextCursor(t *testing.T) {
	schema := loadYAML[schemaDoc](t, "api/openapi/components/schemas/ProfessionalListResponse.yaml")
	if len(schema.Properties) != 6 {
		t.Fatalf("expected cursor fields and four optional page fields")
	}
	for _, name := range []string{"items", "nextCursor", "page", "pageSize", "total", "totalPages"} {
		if _, ok := schema.Properties[name]; !ok {
			t.Fatalf("missing %s", name)
		}
	}
}

// --- Operaciones -----------------------------------------------------------

func TestContract_ListProfessionalsOperation_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	requireResponses(t, doc.Collection.Get, "listProfessionals", []string{"200", "400", "401", "500"})
}

func TestContract_CreateProfessionalOperation_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	requireResponses(t, doc.Collection.Post, "createProfessional", []string{"201", "400", "401", "403", "409", "422", "500"})
}

func TestContract_GetProfessionalOperation_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	requireResponses(t, doc.Item.Get, "getProfessional", []string{"200", "401", "403", "404", "500"})
}

func TestContract_RenameProfessionalOperation_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	requireResponses(t, doc.Item.Patch, "renameProfessional", []string{"200", "400", "401", "403", "404", "422", "500"})
}

// DEC-104: la fotografía es contenido binario, sin Idempotency-Key (el PUT
// reemplaza y es idempotente por naturaleza).
func TestContract_PutProfessionalPhotoOperation_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	requireResponses(t, doc.Photo.Put, "putProfessionalPhoto", []string{"200", "400", "401", "403", "404", "422", "500"})
}

func TestContract_GetProfessionalPhotoOperation_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	requireResponses(t, doc.Photo.Get, "getProfessionalPhoto", []string{"200", "304", "401", "403", "404", "500"})
}

func TestContract_DeleteProfessionalPhotoOperation_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	requireResponses(t, doc.Photo.Delete, "deleteProfessionalPhoto", []string{"204", "401", "403", "404", "500"})
}

// DEC-100: el vínculo propio actúa sobre el principal de la sesión.
func TestContract_MyProfessionalOperations_MethodPathSecurityAndResponses(t *testing.T) {
	doc := loadYAML[staffPathsFile](t, "api/openapi/paths/staff.yaml")
	// Sin vínculo es 200 con professional null, no 404 (DEC-192, issue #721).
	requireResponses(t, doc.Me.Get, "getMyProfessional", []string{"200", "401", "500"})
	requireResponses(t, doc.Me.Put, "linkMyProfessional", []string{"200", "400", "401", "403", "404", "409", "500"})
	requireResponses(t, doc.Me.Delete, "unlinkMyProfessional", []string{"204", "401", "403", "500"})
}

// DEC-192: el cuerpo del GET propio es { professional: ProfessionalResponse | null } y la
// clave es obligatoria, así que el handler la serializa siempre, también como null.
func TestContract_MyProfessionalResponse_RequiredNullableProfessional(t *testing.T) {
	schema := loadYAML[schemaDoc](t, "api/openapi/components/schemas/MyProfessionalResponse.yaml")
	requireProps(t, schema, []string{"professional"})
	prop, _ := schema.Properties["professional"].(map[string]any)
	variants, _ := prop["oneOf"].([]any)
	var hasRef, hasNull bool
	for _, v := range variants {
		m, _ := v.(map[string]any)
		if ref, _ := m["$ref"].(string); ref == "./ProfessionalResponse.yaml" {
			hasRef = true
		}
		if m["type"] == "null" {
			hasNull = true
		}
	}
	if !hasRef || !hasNull {
		t.Fatalf("professional debe ser oneOf ProfessionalResponse | null, es %v", prop)
	}
	resp := loadYAML[map[string]any](t, "api/openapi/components/responses/MyProfessionalSuccess.yaml")
	if !strings.Contains(fmt.Sprint(resp["content"]), "MyProfessionalResponse.yaml") {
		t.Fatalf("MyProfessionalSuccess debe usar MyProfessionalResponse: %v", resp["content"])
	}
}

func TestContract_LinkMyProfessionalRequestSchema_OnlyProfessionalID(t *testing.T) {
	schema := loadYAML[schemaDoc](t, "api/openapi/components/schemas/LinkMyProfessionalRequest.yaml")
	requireProps(t, schema, []string{"professionalId"})
	for _, forbidden := range []string{"staffUserId", "userId", "businessId"} {
		if _, ok := schema.Properties[forbidden]; ok {
			t.Errorf("el vínculo propio nunca debe aceptar %q: nadie asigna el vínculo de otra persona", forbidden)
		}
	}
}

// TestContract_OpenAPIYAML_RegistersStaffPaths confirma que openapi.yaml
// registra ambos paths bajo el mismo documento raíz que las demás
// operaciones privadas, con la misma técnica de referencia JSON pointer.
func TestContract_OpenAPIYAML_RegistersStaffPaths(t *testing.T) {
	type pathsDoc struct {
		Paths map[string]any `yaml:"paths"`
	}
	doc := loadYAML[pathsDoc](t, "api/openapi/openapi.yaml")

	if _, ok := doc.Paths["/private/professionals"]; !ok {
		t.Fatal("openapi.yaml no registra paths./private/professionals")
	}
	if _, ok := doc.Paths["/private/professionals/{professionalId}"]; !ok {
		t.Fatal("openapi.yaml no registra paths./private/professionals/{professionalId}")
	}
	if _, ok := doc.Paths["/private/me/professional"]; !ok {
		t.Fatal("openapi.yaml no registra paths./private/me/professional")
	}
	if _, ok := doc.Paths["/private/professionals/{professionalId}/photo"]; !ok {
		t.Fatal("openapi.yaml no registra paths./private/professionals/{professionalId}/photo")
	}
}
