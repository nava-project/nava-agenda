package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/modules/staff/httpapi"
)

const myProfessionalID = "8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4"

func TestGetMyProfessionalHandler_UsesThePrincipalAndReturnsTheProfessional(t *testing.T) {
	now := time.Now().UTC()
	repo := &fakeRepository{getLinkedFn: func(shop, user string) (staff.Professional, bool, error) {
		if shop != testShopID || user != "u-1" {
			t.Fatalf("debe consultar con el principal de la sesión, recibió %q/%q", shop, user)
		}
		return staff.Professional{ID: myProfessionalID, FullName: "Carlos", CreatedAt: now, UpdatedAt: now}, true, nil
	}}
	rec := httptest.NewRecorder()
	httpapi.NewGetMyProfessionalHandler(staff.NewService(repo)).ServeHTTP(rec,
		requestWithPrincipal(http.MethodGet, "/api/v1/private/me/professional", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Professional map[string]any `json:"professional"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Professional["id"] != myProfessionalID {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
	if _, leaked := body.Professional["staffUserId"]; leaked {
		t.Fatal("la respuesta nunca debe exponer staffUserId")
	}
}

// «Sin ficha» es un estado del contrato (DEC-192, issue #721): 200 con professional null,
// con la clave presente, en lugar del 404 que el navegador registraba como error de red.
func TestGetMyProfessionalHandler_WithoutLink_Is200WithNull(t *testing.T) {
	repo := &fakeRepository{getLinkedFn: func(string, string) (staff.Professional, bool, error) { return staff.Professional{}, false, nil }}
	rec := httptest.NewRecorder()
	httpapi.NewGetMyProfessionalHandler(staff.NewService(repo)).ServeHTTP(rec,
		requestWithPrincipal(http.MethodGet, "/api/v1/private/me/professional", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"professional":null}` {
		t.Fatalf("expected {\"professional\":null}, got %s", got)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected application/json, got %q", ct)
	}
}

func TestLinkMyProfessionalHandler_Success(t *testing.T) {
	repo := &fakeRepository{linkFn: func(shop, user, professional string) (staff.LinkResult, error) {
		if shop != testShopID || user != "u-1" || professional != myProfessionalID {
			t.Fatalf("argumentos inesperados %q/%q/%q", shop, user, professional)
		}
		return staff.LinkResult{Found: true, Professional: staff.Professional{ID: myProfessionalID, FullName: "Carlos"}}, nil
	}}
	rec := httptest.NewRecorder()
	httpapi.NewLinkMyProfessionalHandler(staff.NewService(repo)).ServeHTTP(rec,
		requestWithPrincipal(http.MethodPut, "/api/v1/private/me/professional", []byte(`{"professionalId":"`+myProfessionalID+`"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLinkMyProfessionalHandler_RejectsAnyoneElsesUserID(t *testing.T) {
	repo := &fakeRepository{linkFn: func(string, string, string) (staff.LinkResult, error) {
		t.Fatal("un cuerpo con staffUserId nunca debe llegar al repositorio")
		return staff.LinkResult{}, nil
	}}
	for name, body := range map[string]string{
		"staffUserId":    `{"professionalId":"` + myProfessionalID + `","staffUserId":"otro-usuario"}`,
		"campo extra":    `{"professionalId":"` + myProfessionalID + `","x":1}`,
		"JSON inválido":  `{`,
		"dos documentos": `{"professionalId":"` + myProfessionalID + `"}{}`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			httpapi.NewLinkMyProfessionalHandler(staff.NewService(repo)).ServeHTTP(rec,
				requestWithPrincipal(http.MethodPut, "/api/v1/private/me/professional", []byte(body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestLinkMyProfessionalHandler_TakenProfessional_Is409WithoutRevealingTheOwner(t *testing.T) {
	repo := &fakeRepository{linkFn: func(string, string, string) (staff.LinkResult, error) {
		return staff.LinkResult{Found: true, Taken: true}, nil
	}}
	rec := httptest.NewRecorder()
	httpapi.NewLinkMyProfessionalHandler(staff.NewService(repo)).ServeHTTP(rec,
		requestWithPrincipal(http.MethodPut, "/api/v1/private/me/professional", []byte(`{"professionalId":"`+myProfessionalID+`"}`)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if problem := decodeProblem(t, rec); problem["code"] != "conflict" {
		t.Fatalf("unexpected problem: %v", problem)
	}
}

func TestLinkMyProfessionalHandler_UnknownProfessional_Is404(t *testing.T) {
	repo := &fakeRepository{linkFn: func(string, string, string) (staff.LinkResult, error) { return staff.LinkResult{}, nil }}
	rec := httptest.NewRecorder()
	httpapi.NewLinkMyProfessionalHandler(staff.NewService(repo)).ServeHTTP(rec,
		requestWithPrincipal(http.MethodPut, "/api/v1/private/me/professional", []byte(`{"professionalId":"`+myProfessionalID+`"}`)))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestUnlinkMyProfessionalHandler_Is204AndIdempotent(t *testing.T) {
	for _, released := range []string{myProfessionalID, ""} {
		repo := &fakeRepository{unlinkFn: func(shop, user string) (string, error) {
			if shop != testShopID || user != "u-1" {
				t.Fatalf("debe usar el principal, recibió %q/%q", shop, user)
			}
			return released, nil
		}}
		rec := httptest.NewRecorder()
		httpapi.NewUnlinkMyProfessionalHandler(staff.NewService(repo)).ServeHTTP(rec,
			requestWithPrincipal(http.MethodDelete, "/api/v1/private/me/professional", nil))
		if rec.Code != http.StatusNoContent || strings.TrimSpace(rec.Body.String()) != "" {
			t.Fatalf("expected an empty 204, got %d %q", rec.Code, rec.Body.String())
		}
	}
}
