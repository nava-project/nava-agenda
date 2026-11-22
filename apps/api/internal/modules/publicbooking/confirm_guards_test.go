package publicbooking_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// Guardas de la confirmación pública y piezas puras del contrato (HU-091,
// HU-096, HU-097, HU-104): lo que se rechaza antes de reservar nunca toca el
// puerto de escritura, y el cursor y el precio públicos son reversibles y
// estables (CP-NF07).

func TestConfirmAppointment_RejectsBeforeWriting(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	startsAt := time.Date(2026, time.September, 14, 9, 0, 0, 0, loc)

	for _, tc := range []struct {
		name string
		mut  func(*publicbooking.ConfirmPublicAppointmentInput)
		want apperr.Kind
	}{
		{"enlace vacío", func(in *publicbooking.ConfirmPublicAppointmentInput) { in.Slug = "  " }, apperr.KindNotFound},
		{"enlace demasiado largo", func(in *publicbooking.ConfirmPublicAppointmentInput) {
			in.Slug = strings.Repeat("a", publicbooking.MaxSlugLength+1)
		}, apperr.KindNotFound},
		{"servicio sin forma de UUID", func(in *publicbooking.ConfirmPublicAppointmentInput) { in.ServiceID = "corte" }, apperr.KindNotFound},
		{"profesional sin forma de UUID", func(in *publicbooking.ConfirmPublicAppointmentInput) { in.ProfessionalID = "b-1" }, apperr.KindNotFound},
		{"inicio que no es ISO 8601", func(in *publicbooking.ConfirmPublicAppointmentInput) { in.StartsAtRaw = "mañana a las 9" }, apperr.KindInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, _, _, appointments, email := newConfirmationFixture(now)
			captured := &capturedAppointmentCall{}
			appointments.captured = captured
			in := validConfirmInput(startsAt)
			tc.mut(&in)
			_, _, err := svc.ConfirmAppointment(context.Background(), in, idempotency.Key("k"), idempotency.Fingerprint("f"))
			appErr, ok := apperr.As(err)
			if !ok || appErr.Kind != tc.want {
				t.Fatalf("esperaba %v, got %v", tc.want, err)
			}
			if captured.businessID != "" || len(email.calls) != 0 {
				t.Fatal("una confirmación rechazada no debe reservar ni enviar correo")
			}
		})
	}
}

func TestConfirmAppointment_ServiceNoLongerAssigned_IsUniformNotFound(t *testing.T) {
	loc, _ := time.LoadLocation("America/Bogota")
	now := time.Date(2026, time.September, 14, 8, 0, 0, 0, loc)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	assignments.found = false
	availability := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	profiles := &fakeRepository{found: true, profile: publicbooking.BusinessProfile{Name: "Barbería Alfa", Timezone: "America/Bogota"}}
	appointments := &fakePublicAppointmentPort{captured: &capturedAppointmentCall{}}
	svc := publicbooking.NewConfirmationService(profiles, repo, availability, assignments, &fakeCustomerRepository{}, appointments,
		&fakeConfirmationEmailPort{}, fixedAvailabilityClock{now: now}, "https://reservas.example.test")

	_, _, err := svc.ConfirmAppointment(context.Background(), validConfirmInput(time.Date(2026, time.September, 14, 9, 0, 0, 0, loc)), "k", "f")
	if appErr, ok := apperr.As(err); !ok || appErr.Kind != apperr.KindNotFound {
		t.Fatalf("esperaba 404 uniforme, got %v", err)
	}
	if appointments.captured.businessID != "" {
		t.Fatal("sin asignación vigente no debe reservarse")
	}
}

func TestNormalizeAndValidateCustomerIdentity_ForSomeoneElse_RejectsAnOverlongAttendeeName(t *testing.T) {
	in := validIdentityInput()
	in.ForSomeoneElse = true
	in.AttendeeName = strPtr(strings.Repeat("a", publicbooking.AttendeeNameMaxLength+1))
	_, err := publicbooking.NormalizeAndValidateCustomerIdentity(in)
	assertValidation(t, err)
}

func TestServiceCursor_RoundTripsAndRejectsForeignValues(t *testing.T) {
	want := publicbooking.ServiceCursor{CreatedAt: time.Date(2026, 9, 14, 15, 0, 0, 0, time.UTC), ID: availServiceID}
	got, err := publicbooking.DecodeServiceCursor(publicbooking.EncodeServiceCursor(want))
	if err != nil || !got.CreatedAt.Equal(want.CreatedAt) || got.ID != want.ID {
		t.Fatalf("ida y vuelta = %+v, %v", got, err)
	}
	for name, raw := range map[string]string{
		"no es base64":    "%%%",
		"no es JSON":      "bm8tanNvbg",
		"sin id ni fecha": "e30",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := publicbooking.DecodeServiceCursor(raw)
			if appErr, ok := apperr.As(err); !ok || appErr.Kind != apperr.KindInvalid {
				t.Fatalf("esperaba entrada inválida, got %v", err)
			}
		})
	}
}

func TestFormatServicePriceCOP_AlwaysTwoDecimals(t *testing.T) {
	for cents, want := range map[int64]string{0: "0.00", 5: "0.05", 2000000: "20000.00", 4500050: "45000.50"} {
		if got := publicbooking.FormatServicePriceCOP(cents); got != want {
			t.Errorf("FormatServicePriceCOP(%d) = %q, want %q", cents, got, want)
		}
	}
}

func TestOfferedRescheduleStarts_NonPositiveDuration_IsInternal(t *testing.T) {
	now := time.Date(2026, time.September, 14, 13, 0, 0, 0, time.UTC)
	repo, effectiveDay, blocks, policy, assignments, timezones := newAvailabilityFixture(now)
	svc := publicbooking.NewAvailabilityService(repo, effectiveDay, blocks, policy, assignments, timezones, fixedAvailabilityClock{now: now})
	_, err := svc.OfferedRescheduleStarts(context.Background(), "shop-1", availProfessionalID, 0, now, now.Add(30*time.Minute))
	if appErr, ok := apperr.As(err); !ok || appErr.Kind != apperr.KindInternal {
		t.Fatalf("esperaba error interno, got %v", err)
	}
}
