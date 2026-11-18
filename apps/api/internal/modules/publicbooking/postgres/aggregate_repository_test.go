// Pruebas de integración de los agregados públicos de solo lectura (DEC-162)
// contra PostgreSQL REAL con el rol de aplicación (agenda_app, sin
// BYPASSRLS) y DOS tenants. Requieren todas las migraciones aplicadas y
// database/testdata/dec162_agregados_publicos.sql cargado.
//
//	export TEST_DATABASE_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable"
//	go test -race ./internal/modules/publicbooking/postgres/...
package postgres_test

import (
	"context"
	"reflect"
	"testing"

	publicbookingpostgres "nava-agenda/internal/modules/publicbooking/postgres"
)

const (
	slugAggUno = "barberia-dec162-uno"
	slugAggDos = "barberia-dec162-dos"

	businessAggUnoID = "01620001-0162-0162-0162-016200010001"
	businessAggDosID = "01620002-0162-0162-0162-016200020002"

	professionalAggUno1 = "01620011-0162-0162-0162-016200110011"
	professionalAggUno2 = "01620012-0162-0162-0162-016200120012"
	professionalAggDos1 = "01620021-0162-0162-0162-016200210021"

	serviceAggS1             = "01620101-0162-0162-0162-016201010101"
	serviceAggS2             = "01620102-0162-0162-0162-016201020102"
	serviceAggInactive       = "01620103-0162-0162-0162-016201030103"
	serviceAggNoProfessional = "01620104-0162-0162-0162-016201040104"
	serviceAggDos            = "01620201-0162-0162-0162-016202010201"
)

func TestListPublicProfessionalsWithServices_ReturnsEligibleProfessionalsWithTheirActiveServices(t *testing.T) {
	repo := publicbookingpostgres.New(setupTestDB(t))

	got, found, err := repo.ListPublicProfessionalsWithServices(context.Background(), slugAggUno)
	if err != nil {
		t.Fatalf("ListPublicProfessionalsWithServices: %v", err)
	}
	if !found {
		t.Fatal("found = false, want true")
	}

	// Uno-3 (sin asignaciones) y Uno-4 (solo un servicio inactivo) no son
	// elegibles; Uno-1 no lista el servicio inactivo S3 aunque lo tenga
	// asignado; el orden es (created_at del profesional, id) y el de serviceIds
	// (created_at del servicio, id).
	if len(got.Items) != 2 {
		t.Fatalf("esperaba 2 profesionales elegibles, got %+v", got.Items)
	}
	first, second := got.Items[0], got.Items[1]
	if first.ID != professionalAggUno1 || first.FullName != "Barbero DEC-162 Uno-1" {
		t.Fatalf("primer profesional inesperado: %+v", first)
	}
	if want := []string{serviceAggS1, serviceAggS2}; !reflect.DeepEqual(first.ServiceIDs, want) {
		t.Fatalf("serviceIds de Uno-1 = %v, want %v", first.ServiceIDs, want)
	}
	if second.ID != professionalAggUno2 || !reflect.DeepEqual(second.ServiceIDs, []string{serviceAggS2}) {
		t.Fatalf("segundo profesional inesperado: %+v", second)
	}
}

func TestListPublicProfessionalsWithServices_TenantIsolation(t *testing.T) {
	repo := publicbookingpostgres.New(setupTestDB(t))

	got, found, err := repo.ListPublicProfessionalsWithServices(context.Background(), slugAggDos)
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if len(got.Items) != 1 || got.Items[0].ID != professionalAggDos1 || !reflect.DeepEqual(got.Items[0].ServiceIDs, []string{serviceAggDos}) {
		t.Fatalf("Dos solo debe ver su propio profesional y servicio: %+v", got.Items)
	}
	for _, b := range got.Items {
		for _, id := range b.ServiceIDs {
			if id == serviceAggS1 || id == serviceAggS2 {
				t.Fatalf("un servicio de Uno se filtró a Dos: %v", b)
			}
		}
	}
}

func TestListPublicProfessionalsWithServices_UnknownOrUnpublishableSlug_IsNotFound(t *testing.T) {
	repo := publicbookingpostgres.New(setupTestDB(t))

	// Desconocido y de forma inválida son indistinguibles (CA-090-02).
	for _, slug := range []string{"no-existe-nunca", "Slug Inválido!!"} {
		got, found, err := repo.ListPublicProfessionalsWithServices(context.Background(), slug)
		if err != nil {
			t.Fatalf("slug %q: %v", slug, err)
		}
		if found || len(got.Items) != 0 {
			t.Fatalf("slug %q: found=%v items=%v, want not found", slug, found, got.Items)
		}
	}
}

func TestListServiceProfessionalIDs_OnlyActiveServiceAndTenantIsolation(t *testing.T) {
	repo := publicbookingpostgres.New(setupTestDB(t))
	ctx := context.Background()

	tests := []struct {
		name       string
		businessID string
		serviceID  string
		want       []string
	}{
		{"S1: un profesional", businessAggUnoID, serviceAggS1, []string{professionalAggUno1}},
		{"S2: dos profesionales en orden de asignación", businessAggUnoID, serviceAggS2, []string{professionalAggUno1, professionalAggUno2}},
		{"servicio inactivo no expone profesionales", businessAggUnoID, serviceAggInactive, []string{}},
		{"servicio activo sin profesionales", businessAggUnoID, serviceAggNoProfessional, []string{}},
		{"servicio de otro negocio visto desde Uno", businessAggUnoID, serviceAggDos, []string{}},
		{"servicio de Uno visto desde Dos", businessAggDosID, serviceAggS2, []string{}},
		{"servicio propio de Dos", businessAggDosID, serviceAggDos, []string{professionalAggDos1}},
		{"servicio inexistente", businessAggUnoID, "00000000-0000-0000-0000-000000000000", []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := repo.ListServiceProfessionalIDs(ctx, tc.businessID, tc.serviceID)
			if err != nil {
				t.Fatalf("ListServiceProfessionalIDs: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}
