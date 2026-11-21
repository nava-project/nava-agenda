package booking_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/idempotency"
)

// PublicAppointmentAdapter (HU-097) es la última frontera antes de persistir
// una reserva pública: arma CreatePublicInput desde los tipos universales del
// puerto y la valida, así que una entrada mal formada nunca llega al
// repositorio (CP-NF07).

type fakePublicRepository struct {
	fakeManualRepository
	calls     int
	lastInput booking.CreatePublicInput
	err       error
}

func (f *fakePublicRepository) CreatePublic(_ context.Context, _ string, input booking.CreatePublicInput, _ idempotency.Key, _ idempotency.Fingerprint) (booking.CreatePublicResult, error) {
	f.calls++
	f.lastInput = input
	if f.err != nil {
		return booking.CreatePublicResult{}, f.err
	}
	return booking.CreatePublicResult{
		Decision: idempotency.Decision{Outcome: idempotency.OutcomeProceed},
		Response: idempotency.StoredResponse{Status: 201},
	}, nil
}

func (f *fakePublicRepository) ReplayPublic(context.Context, string, idempotency.Key, idempotency.Fingerprint) (booking.CreatePublicResult, error) {
	f.calls++
	if f.err != nil {
		return booking.CreatePublicResult{}, f.err
	}
	return booking.CreatePublicResult{Decision: idempotency.Decision{Outcome: idempotency.OutcomeReplay}, Response: idempotency.StoredResponse{Status: 201}}, nil
}

// publicCall reúne los argumentos del puerto con valores válidos: una cita
// de 30 min a las 10:00 en la Barbería Alfa, cliente nuevo y sin domicilio.
type publicCall struct {
	attendee, serviceName, currency string
	duration                        int
	price                           int64
	startsAt, endsAt                time.Time
	note                            *string
	homeAddress                     *string
	homeLat, homeLng                *float64
	existingID                      *string
	fullName, phone, email          string
	tokenPlain, tokenHash           string
	issuedAt, expiresAt             time.Time
	businessName, timezone          string
}

func validPublicCall() publicCall {
	start := time.Date(2026, 9, 14, 15, 0, 0, 0, time.UTC)
	return publicCall{
		attendee: "Cliente Alfa", serviceName: "Corte clásico", currency: "COP", duration: 30, price: 2000000,
		startsAt: start, endsAt: start.Add(30 * time.Minute),
		fullName: "Cliente Alfa", phone: "+573001112233", email: "cliente@alfa.example.test",
		tokenPlain: "token-en-claro", tokenHash: strings.Repeat("a", 64),
		issuedAt: start.Add(-time.Hour), expiresAt: start.Add(90 * 24 * time.Hour),
		businessName: "Barbería Alfa", timezone: "America/Bogota",
	}
}

func (c publicCall) run(adapter booking.PublicAppointmentAdapter) (idempotency.Decision, idempotency.StoredResponse, error) {
	return adapter.CreatePublicAppointment(context.Background(), "barberia-alfa", c.businessName, c.timezone,
		"prof-1", "serv-1", c.startsAt, c.endsAt, c.attendee, c.serviceName, c.duration, c.price, c.currency,
		c.note, c.homeAddress, c.homeLat, c.homeLng, c.existingID, nil, nil, c.fullName, c.phone, c.email,
		c.tokenPlain, c.tokenHash, c.issuedAt, c.expiresAt, "k-1", "f-1")
}

func TestPublicAppointmentAdapter_ValidCall_BuildsANewCustomerAndPersists(t *testing.T) {
	repo := &fakePublicRepository{}
	decision, stored, err := validPublicCall().run(booking.NewPublicAppointmentAdapter(repo))
	if err != nil {
		t.Fatalf("CreatePublicAppointment: %v", err)
	}
	if decision.Outcome != idempotency.OutcomeProceed || stored.Status != 201 || repo.calls != 1 {
		t.Fatalf("resultado inesperado: %+v %+v (%d llamadas)", decision, stored, repo.calls)
	}
	in := repo.lastInput
	if in.Customer.ExistingID != nil || in.Customer.New == nil || in.Customer.New.FullName != "Cliente Alfa" ||
		in.Customer.New.Phone == nil || *in.Customer.New.Phone != "+573001112233" || in.HomeService != nil {
		t.Fatalf("entrada inesperada: %+v", in)
	}
	if in.Service.Name != "Corte clásico" || in.Service.DurationMinutes != 30 || in.TokenHash != strings.Repeat("a", 64) {
		t.Fatalf("instantánea o token inesperados: %+v", in)
	}
}

func TestPublicAppointmentAdapter_ExistingCustomerAndHomeService(t *testing.T) {
	repo := &fakePublicRepository{}
	call := validPublicCall()
	existing := "cust-7"
	address := "Calle 1 # 2-3"
	lat, lng := 4.6, -74.08
	call.existingID, call.homeAddress, call.homeLat, call.homeLng = &existing, &address, &lat, &lng
	call.phone = ""
	if _, _, err := call.run(booking.NewPublicAppointmentAdapter(repo)); err != nil {
		t.Fatalf("CreatePublicAppointment: %v", err)
	}
	in := repo.lastInput
	if in.Customer.ExistingID == nil || *in.Customer.ExistingID != "cust-7" || in.Customer.New != nil {
		t.Fatalf("debía usar el cliente existente: %+v", in.Customer)
	}
	if in.HomeService == nil || in.HomeService.Address != address || in.HomeService.Latitude != lat {
		t.Fatalf("domicilio inesperado: %+v", in.HomeService)
	}

	// Una dirección sin coordenadas no es un domicilio: el turno queda en el local.
	repo2 := &fakePublicRepository{}
	partial := validPublicCall()
	partial.homeAddress = &address
	if _, _, err := partial.run(booking.NewPublicAppointmentAdapter(repo2)); err != nil {
		t.Fatalf("CreatePublicAppointment: %v", err)
	}
	if repo2.lastInput.HomeService != nil {
		t.Fatalf("sin coordenadas no debe haber domicilio: %+v", repo2.lastInput.HomeService)
	}
}

func TestPublicAppointmentAdapter_InvalidInput_NeverReachesTheRepository(t *testing.T) {
	long := strings.Repeat("x", 600)
	badLat := 120.0
	lng := -74.0
	address := "Calle 1"
	for _, tc := range []struct {
		name string
		mut  func(*publicCall)
		kind apperr.Kind
	}{
		{"sin nombre de quien asiste", func(c *publicCall) { c.attendee = "  " }, apperr.KindValidation},
		{"nombre de quien asiste demasiado largo", func(c *publicCall) { c.attendee = long }, apperr.KindValidation},
		{"fin antes del inicio", func(c *publicCall) { c.endsAt = c.startsAt.Add(-time.Minute) }, apperr.KindValidation},
		{"el intervalo no coincide con la duración", func(c *publicCall) { c.endsAt = c.startsAt.Add(45 * time.Minute) }, apperr.KindValidation},
		{"servicio sin nombre", func(c *publicCall) { c.serviceName = "" }, apperr.KindValidation},
		{"servicio con nombre demasiado largo", func(c *publicCall) { c.serviceName = long }, apperr.KindValidation},
		{"precio negativo", func(c *publicCall) { c.price = -1 }, apperr.KindValidation},
		{"moneda inválida", func(c *publicCall) { c.currency = "pesos" }, apperr.KindValidation},
		{"nota demasiado larga", func(c *publicCall) { n := strings.Repeat("n", 5000); c.note = &n }, apperr.KindValidation},
		{"cliente nuevo sin nombre", func(c *publicCall) { c.fullName = "" }, apperr.KindValidation},
		{"cliente con nombre demasiado largo", func(c *publicCall) { c.fullName = long }, apperr.KindValidation},
		{"teléfono inválido", func(c *publicCall) { c.phone = "3001112233" }, apperr.KindValidation},
		{"correo con mayúsculas", func(c *publicCall) { c.email = "Cliente@Alfa.example.test" }, apperr.KindValidation},
		// El domicilio ya lo valida publicbooking: aquí llega mal solo por un defecto.
		{"domicilio fuera de rango", func(c *publicCall) { c.homeAddress, c.homeLat, c.homeLng = &address, &badLat, &lng }, apperr.KindInternal},
		{"hash del token con otra forma", func(c *publicCall) { c.tokenHash = "corto" }, apperr.KindInternal},
		{"el token vence antes de emitirse", func(c *publicCall) { c.expiresAt = c.issuedAt }, apperr.KindInternal},
		{"sin zona del negocio", func(c *publicCall) { c.timezone = " " }, apperr.KindInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakePublicRepository{}
			call := validPublicCall()
			tc.mut(&call)
			_, _, err := call.run(booking.NewPublicAppointmentAdapter(repo))
			assertKind(t, err, tc.kind)
			if repo.calls != 0 {
				t.Fatal("una entrada inválida no debe llegar al repositorio")
			}
		})
	}
}

func TestPublicAppointmentAdapter_RepositoryErrorsPropagate(t *testing.T) {
	wantErr := errors.New("conexión perdida")
	repo := &fakePublicRepository{err: wantErr}
	adapter := booking.NewPublicAppointmentAdapter(repo)
	if _, _, err := validPublicCall().run(adapter); !errors.Is(err, wantErr) {
		t.Fatalf("CreatePublicAppointment err = %v, want %v", err, wantErr)
	}
	if _, _, err := adapter.ReplayPublicAppointment(context.Background(), "barberia-alfa", "k-1", "f-1"); !errors.Is(err, wantErr) {
		t.Fatalf("ReplayPublicAppointment err = %v, want %v", err, wantErr)
	}

	ok := booking.NewPublicAppointmentAdapter(&fakePublicRepository{})
	decision, _, err := ok.ReplayPublicAppointment(context.Background(), "barberia-alfa", "k-1", "f-1")
	if err != nil || decision.Outcome != idempotency.OutcomeReplay {
		t.Fatalf("ReplayPublicAppointment = %+v, %v", decision, err)
	}
}
