package postgres_test

import (
	"context"
	"testing"
	"time"

	publicbookingpostgres "nava-agenda/internal/modules/publicbooking/postgres"
	"nava-agenda/internal/platform/database"
)

// setNoShowCut guarda el corte de un no_show por SQL directo, como lo deja
// MarkNoShow (DEC-193).
func setNoShowCut(t *testing.T, db *database.DB, businessID, appointmentID string, cut time.Time) {
	t.Helper()
	err := db.InTenantTx(context.Background(), database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx, `UPDATE appointment SET no_show_cut_at = $3 WHERE business_id = $1 AND id = $2`,
			businessID, appointmentID, cut)
		return err
	})
	if err != nil {
		t.Fatalf("setNoShowCut: %v", err)
	}
}

// TestListOccupiedIntervals_NoShowCut_EndsAtTheCut cubre DEC-193 en la lectura
// que comparten la reserva pública y «Nuevo turno»: un no_show con corte
// ocupa hasta el corte; con el corte en el inicio no ocupa nada; con el corte
// después del fin, o sin corte (API anterior), ocupa la franja entera.
func TestListOccupiedIntervals_NoShowCut_EndsAtTheCut(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)
	base := randomFutureBase()
	slot := func(h int) (time.Time, time.Time) {
		s := base.Add(time.Duration(h) * time.Hour)
		return s, s.Add(30 * time.Minute)
	}

	cutStart, cutEnd := slot(0)
	id := createAppointmentForOccupancy(t, db, businessAvailUnoID, professionalAvailUnoID, serviceAvailUnoID, "no_show", cutStart, cutEnd)
	setNoShowCut(t, db, businessAvailUnoID, id, cutStart.Add(10*time.Minute))

	emptyStart, emptyEnd := slot(1)
	id = createAppointmentForOccupancy(t, db, businessAvailUnoID, professionalAvailUnoID, serviceAvailUnoID, "no_show", emptyStart, emptyEnd)
	setNoShowCut(t, db, businessAvailUnoID, id, emptyStart)

	lateStart, lateEnd := slot(2)
	id = createAppointmentForOccupancy(t, db, businessAvailUnoID, professionalAvailUnoID, serviceAvailUnoID, "no_show", lateStart, lateEnd)
	setNoShowCut(t, db, businessAvailUnoID, id, lateEnd.Add(2*time.Hour))

	oldStart, oldEnd := slot(3)
	createAppointmentForOccupancy(t, db, businessAvailUnoID, professionalAvailUnoID, serviceAvailUnoID, "no_show", oldStart, oldEnd)

	starts, ends, err := repo.ListOccupiedIntervals(context.Background(), businessAvailUnoID, professionalAvailUnoID, base, base.Add(10*time.Hour))
	if err != nil {
		t.Fatalf("ListOccupiedIntervals: %v", err)
	}
	want := [][2]time.Time{
		{cutStart, cutStart.Add(10 * time.Minute)},
		{lateStart, lateEnd},
		{oldStart, oldEnd},
	}
	if len(starts) != len(want) {
		t.Fatalf("intervalos = %v → %v, want %v", starts, ends, want)
	}
	for i, w := range want {
		if !starts[i].Equal(w[0]) || !ends[i].Equal(w[1]) {
			t.Fatalf("intervalo %d = [%v, %v), want [%v, %v)", i, starts[i], ends[i], w[0], w[1])
		}
	}
}
