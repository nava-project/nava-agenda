package access_test

import (
	"testing"

	"nava-agenda/internal/modules/access"
)

func TestIsRestricted_FollowsTheRolePriorityOfDEC134(t *testing.T) {
	cases := []struct {
		roles []string
		want  bool
	}{
		{nil, false},
		{[]string{"empleado"}, true},
		{[]string{"empleado", "independiente"}, false},
		{[]string{"empleado", "empresa"}, false},
		{[]string{"empresa"}, false},
		{[]string{"independiente"}, false},
	}
	for _, tc := range cases {
		if got := access.IsRestricted(tc.roles); got != tc.want {
			t.Errorf("IsRestricted(%v) = %v, want %v", tc.roles, got, tc.want)
		}
	}
}

func TestScope_Owns(t *testing.T) {
	if !(access.Scope{}).Owns("cualquiera") {
		t.Fatal("sin restricción se alcanza cualquier profesional")
	}
	own := access.Scope{Restricted: true, ProfessionalID: "b1"}
	if !own.Owns("b1") || own.Owns("b2") {
		t.Fatal("el empleado solo alcanza su profesional")
	}
	if (access.Scope{Restricted: true}).Owns("") {
		t.Fatal("sin vínculo no alcanza ningún profesional, ni siquiera el id vacío")
	}
}

func TestPolicy_MatchesPatternsAndRejectsDuplicates(t *testing.T) {
	p, err := access.NewPolicy([]access.Entry{
		{Method: "GET", Pattern: "/professionals/{professionalId}/time-blocks/effective", Rule: access.OwnProfessional},
		{Method: "GET", Pattern: "/professionals/{professionalId}", Rule: access.OwnProfessional},
		{Method: "PATCH", Pattern: "/settings/brand", Rule: access.DenyRestricted},
	})
	if err != nil {
		t.Fatal(err)
	}
	rule, params, ok := p.Match("GET", "/professionals/abc/time-blocks/effective")
	if !ok || rule != access.OwnProfessional || params["professionalId"] != "abc" {
		t.Fatalf("match = %v %v %v", rule, params, ok)
	}
	if _, _, ok := p.Match("GET", "/professionals/abc/otra"); ok {
		t.Fatal("un patrón no debe coincidir con un prefijo")
	}
	if _, _, ok := p.Match("GET", "/settings/brand"); ok {
		t.Fatal("el método forma parte de la regla")
	}
	if _, err := access.NewPolicy([]access.Entry{
		{Method: "GET", Pattern: "/x", Rule: access.Open},
		{Method: "GET", Pattern: "/x", Rule: access.DenyRestricted},
	}); err == nil {
		t.Fatal("una ruta repetida es un error de wiring")
	}
}
