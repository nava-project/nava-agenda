// Caso CP-006 del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III):
// duración del servicio en minutos, sobre un servicio editable de la Barbería
// Alfa. La fracción («30.5») la rechaza el decodificador HTTP antes de llegar
// aquí (catalog/httpapi: TestCreateServiceHandler_FractionalDuration_Returns400).
// La etapa «Pruebas unitarias · Plan de Pruebas (CP)» del Jenkinsfile corre todo
// lo que empieza por TestCP.
package catalog_test

import (
	"context"
	"testing"

	"nava-agenda/internal/modules/catalog"
	"nava-agenda/internal/platform/idempotency"
)

func TestCP006_DuracionDelServicio(t *testing.T) {
	for _, minutes := range []int{30, 45} {
		t.Run("CP-006 se guarda una duración positiva", func(t *testing.T) {
			repo := &fakeRepository{createFn: func(_ context.Context, _ string, input catalog.CreateInput, _ idempotency.Key, _ idempotency.Fingerprint) (catalog.CreateResult, error) {
				if input.DurationMinutes != minutes {
					t.Fatalf("duración guardada = %d, want %d", input.DurationMinutes, minutes)
				}
				return catalog.CreateResult{Decision: idempotency.Decision{Outcome: idempotency.OutcomeProceed}}, nil
			}}
			raw := validCreateRaw()
			raw.DurationMinutes = minutes
			if _, err := catalog.NewService(repo).Create(context.Background(), "barberia-alfa", raw, "cp006-k", "cp006-f"); err != nil {
				t.Fatalf("%d min: %v", minutes, err)
			}
		})
	}

	// Vacío llega como 0: el campo es un entero y el JSON sin él lo deja en cero.
	for name, minutes := range map[string]int{"cero o vacío": 0, "negativo": -15} {
		t.Run("CP-006 se rechaza una duración "+name, func(t *testing.T) {
			raw := validCreateRaw()
			raw.DurationMinutes = minutes
			_, err := catalog.NewService(&fakeRepository{createFn: failingCreateFn(t)}).Create(context.Background(), "barberia-alfa", raw, "cp006-k", "cp006-f")
			mustBeValidation(t, err)
		})
	}
}
