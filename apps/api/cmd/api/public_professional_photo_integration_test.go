package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Fixture hu092_seleccion_profesional.sql (DEC-127): Uno-1 tiene fotografía y un
// servicio activo asignado; Uno-2 no tiene fotografía; Uno-3 tiene fotografía
// pero ninguna asignación vigente.
const (
	professionalPhotoSlug           = "barberia-hu092-uno"
	professionalPhotoWithPhotoID    = "00920011-0092-0092-0092-009200110011"
	professionalPhotoWithoutPhotoID = "00920012-0092-0092-0092-009200120012"
	professionalPhotoNotEligibleID  = "00920014-0092-0092-0092-009200140014"
)

// TestPublicProfessionalPhoto_HTTP_ServesEligibleProfessionalWithoutSession comprueba el
// cableado de la ruta pública: sin cookie, 200 con la imagen y su ETag, 304 a
// la solicitud condicional y el mismo 404 para quien no tiene fotografía o no
// es elegible.
func TestPublicProfessionalPhoto_HTTP_ServesEligibleProfessionalWithoutSession(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { db.Close() })
	router, err := buildRouter(db, discardLogger(), testRouterConfig())
	if err != nil {
		t.Fatalf("buildRouter: %v", err)
	}

	get := func(professionalID, ifNoneMatch string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/public/businesses/"+professionalPhotoSlug+"/professionals/"+professionalID+"/photo", nil)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	ok := get(professionalPhotoWithPhotoID, "")
	if ok.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", ok.Code, ok.Body.String())
	}
	if got := ok.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("expected image/png, got %q", got)
	}
	etag := ok.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected an ETag")
	}

	if rec := get(professionalPhotoWithPhotoID, etag); rec.Code != http.StatusNotModified {
		t.Fatalf("expected 304 for a matching If-None-Match, got %d", rec.Code)
	}

	for name, professionalID := range map[string]string{
		"sin fotografía":    professionalPhotoWithoutPhotoID,
		"no elegible":       professionalPhotoNotEligibleID,
		"id sin forma uuid": "no-es-un-uuid",
	} {
		if rec := get(professionalID, ""); rec.Code != http.StatusNotFound {
			t.Errorf("%s: expected 404, got %d", name, rec.Code)
		}
	}
}
