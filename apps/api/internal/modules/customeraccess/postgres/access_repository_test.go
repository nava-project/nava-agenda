package postgres_test

// Pruebas de integración de HU-105 (acceso al turno con código) contra
// PostgreSQL REAL con dos barberías: database/testdata/hu105_acceso_codigo.sql
// cargado además de las migraciones. El servicio es el real y solo el envío y el
// reloj son dobles; ningún RLS ni resolución de slug se simula (estrategia de
// pruebas §2).

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"sync"
	"testing"
	"time"

	"system-barbershop/internal/modules/booking"
	bookingpostgres "system-barbershop/internal/modules/booking/postgres"
	"system-barbershop/internal/modules/customeraccess"
	customeraccesspostgres "system-barbershop/internal/modules/customeraccess/postgres"
	"system-barbershop/internal/platform/apperr"
	"system-barbershop/internal/platform/database"
	"system-barbershop/internal/platform/idempotency"
)

const (
	accessShopUno    = "01050001-0105-0105-0105-010500010001"
	accessBarberUno  = "01050011-0105-0105-0105-010500110011"
	accessServiceUno = "01050012-0105-0105-0105-010500120012"
	accessShopDos    = "01050002-0105-0105-0105-010500020002"
	accessSlugUno    = "hu105-uno"
	accessSlugDos    = "hu105-dos"
)

var accessSecret = []byte("secreto-de-prueba-hu105-no-real")

// capturedCode registra lo que el servicio habría enviado, en vez de enviarlo.
type capturedCode struct{ channel, destination, code string }

type capturingSender struct {
	mu   sync.Mutex
	sent []capturedCode
}

func (c *capturingSender) SendCode(_ context.Context, channel, destination, code string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, capturedCode{channel, destination, code})
	return nil
}

func (c *capturingSender) last(t *testing.T) capturedCode {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.sent) == 0 {
		t.Fatal("no se envió ningún código")
	}
	return c.sent[len(c.sent)-1]
}

func (c *capturingSender) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.sent)
}

type movableClock struct {
	mu  sync.Mutex
	now time.Time
}

func (m *movableClock) Now() time.Time {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.now
}

func (m *movableClock) advance(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.now = m.now.Add(d)
}

type accessFixture struct {
	db      *database.DB
	service *customeraccess.AccessService
	sender  *capturingSender
	clock   *movableClock
	reader  *customeraccess.Service
}

func newAccessFixture(t *testing.T) *accessFixture {
	t.Helper()
	db := setupTestDB(t)
	sender := &capturingSender{}
	clk := &movableClock{now: time.Now().UTC()}
	return &accessFixture{
		db:     db,
		sender: sender,
		clock:  clk,
		service: customeraccess.NewAccessService(
			customeraccesspostgres.NewAccessRepository(db), sender,
			customeraccess.CryptoCodeGenerator{}, clk, accessSecret, nil,
		).WithSynchronousDelivery(),
		reader: customeraccess.NewService(customeraccesspostgres.New(db)),
	}
}

// bookFor crea un cliente con ese correo y teléfono y un turno futuro confirmado
// en la barbería uno, y devuelve la cita.
func bookFor(t *testing.T, db *database.DB, email, phone string, daysAhead int) booking.Appointment {
	t.Helper()
	return bookWith(t, db, booking.CustomerInput{New: &booking.NewCustomerInput{
		FullName: "Cliente de prueba HU-105", Email: &email, Phone: &phone,
	}}, daysAhead)
}

// bookWith crea el turno futuro para el cliente indicado.
func bookWith(t *testing.T, db *database.DB, customer booking.CustomerInput, _ int) booking.Appointment {
	t.Helper()
	repo := bookingpostgres.New(db, idempotency.NewSQLCoordinator())
	// Año 2029 en adelante con días y horas al azar: barberia_app no puede borrar
	// turnos, así que corridas repetidas contra el mismo PostgreSQL no deben chocar
	// con la exclusión de solapamiento del barbero.
	days, err := rand.Int(rand.Reader, big.NewInt(3650))
	if err != nil {
		t.Fatalf("rand.Int: %v", err)
	}
	hours, err := rand.Int(rand.Reader, big.NewInt(20))
	if err != nil {
		t.Fatalf("rand.Int: %v", err)
	}
	starts := time.Date(2029, 1, 10, 8, 0, 0, 0, time.UTC).
		AddDate(0, 0, int(days.Int64())).
		Add(time.Duration(hours.Int64()) * time.Hour)
	created, err := repo.CreateInternal(context.Background(), accessShopUno, booking.CreateInternalInput{
		BarberID: accessBarberUno, ServiceID: accessServiceUno,
		AttendeeName: "Cliente de prueba HU-105", StartsAt: starts, EndsAt: starts.Add(30 * time.Minute),
		Origin: booking.OriginPublic,
		Service: booking.ServiceSnapshot{
			Name: "Corte de prueba HU-105", DurationMinutes: 30, PriceAmountCents: 2000000, Currency: "COP",
		},
		Customer: customer,
		Actor:    booking.Actor{Type: booking.ActorTypeSystem},
	})
	if err != nil {
		t.Fatalf("CreateInternal: %v", err)
	}
	return created.Appointment
}

func freshContact(t *testing.T) (email, phone string) {
	t.Helper()
	return "hu105-" + uniqueDigits(t, 10) + "@example.test", "+573" + uniqueDigits(t, 9)
}

// freshIP evita que las pruebas compartan el límite por IP (10 cada 15 minutos).
func freshIP(t *testing.T) string { return "198.51.100." + uniqueDigits(t, 1) + uniqueDigits(t, 6) }

func isKind(err error, kind apperr.Kind) bool {
	e, ok := apperr.As(err)
	return ok && e.Kind == kind
}

func TestAccess_EmailFlow_IssuesShortLivedAccessAndConsumesTheCode(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	appt := bookFor(t, f.db, email, phone, 5)

	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	sent := f.sender.last(t)
	if sent.channel != "email" || sent.destination != email {
		t.Fatalf("expected email delivery to the contact, got %+v", sent)
	}

	verified, err := f.service.VerifyCode(ctx, accessSlugUno, email, sent.code)
	if err != nil {
		t.Fatalf("VerifyCode: %v", err)
	}
	if len(verified.Appointments) != 1 || verified.Timezone != "America/Bogota" {
		t.Fatalf("expected one appointment in the shop timezone, got %+v", verified)
	}
	// El acceso emitido abre el turno por el flujo normal del enlace (HU-098).
	view, err := f.reader.GetAppointmentByToken(ctx, verified.Appointments[0].AccessToken)
	if err != nil {
		t.Fatalf("the issued access must open the appointment: %v", err)
	}
	if !view.StartsAt.Equal(appt.StartsAt) {
		t.Fatalf("access opened another appointment: %v vs %v", view.StartsAt, appt.StartsAt)
	}

	// El código se consume: repetirlo falla igual que uno incorrecto.
	if _, err := f.service.VerifyCode(ctx, accessSlugUno, email, sent.code); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("a used code must be rejected as unauthorized, got %v", err)
	}
}

func TestAccess_PhoneFlow_AcceptsCommonWritingsOfTheSameNumber(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 6)

	// El mismo celular escrito sin prefijo y con separadores resuelve al mismo cliente.
	written := phone[3:6] + " " + phone[6:9] + " " + phone[9:]
	if _, err := f.service.RequestCode(ctx, accessSlugUno, written, freshIP(t)); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	sent := f.sender.last(t)
	if sent.channel != "whatsapp" || sent.destination != phone {
		t.Fatalf("expected whatsapp delivery to the normalized E.164 number, got %+v", sent)
	}
	if _, err := f.service.VerifyCode(ctx, accessSlugUno, phone, sent.code); err != nil {
		t.Fatalf("the code must verify with the number written in E.164: %v", err)
	}
}

func TestAccess_UnknownContact_LooksIdenticalAndSendsNothing(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 7)

	known, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t))
	if err != nil {
		t.Fatalf("known: %v", err)
	}
	before := f.sender.count()
	stranger, err := f.service.RequestCode(ctx, accessSlugUno, "nadie-"+uniqueDigits(t, 8)+"@example.test", freshIP(t))
	if err != nil {
		t.Fatalf("unknown: %v", err)
	}
	if known != stranger {
		t.Fatalf("the response must be identical for known and unknown contacts: %+v vs %+v", known, stranger)
	}
	if f.sender.count() != before {
		t.Fatal("an unknown contact must not receive anything")
	}
}

func TestAccess_WrongCodes_ExhaustTheChallenge(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 8)
	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	good := f.sender.last(t).code
	wrong := "000000"
	if good == wrong {
		wrong = "000001"
	}

	for i := 0; i < customeraccess.AccessCodeMaxAttempts; i++ {
		if _, err := f.service.VerifyCode(ctx, accessSlugUno, email, wrong); !isKind(err, apperr.KindUnauthorized) {
			t.Fatalf("attempt %d: expected unauthorized, got %v", i+1, err)
		}
	}
	// Agotados los intentos, ni el código correcto sirve.
	if _, err := f.service.VerifyCode(ctx, accessSlugUno, email, good); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("an exhausted challenge must reject even the right code, got %v", err)
	}
}

func TestAccess_ExpiredCode_IsRejected(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 9)
	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	f.clock.advance(customeraccess.AccessCodeTTL + time.Second)
	if _, err := f.service.VerifyCode(ctx, accessSlugUno, email, f.sender.last(t).code); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("an expired code must be rejected, got %v", err)
	}
}

func TestAccess_AskingAgain_InvalidatesThePreviousCode(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 10)
	ip := freshIP(t)

	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, ip); err != nil {
		t.Fatalf("first: %v", err)
	}
	first := f.sender.last(t).code
	// Un instante después: el «último» reto se decide por su hora de creación.
	f.clock.advance(time.Second)
	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, ip); err != nil {
		t.Fatalf("second: %v", err)
	}
	second := f.sender.last(t).code

	if first != second {
		if _, err := f.service.VerifyCode(ctx, accessSlugUno, email, first); !isKind(err, apperr.KindUnauthorized) {
			t.Fatalf("the older code must stop working, got %v", err)
		}
	}
	if _, err := f.service.VerifyCode(ctx, accessSlugUno, email, second); err != nil {
		t.Fatalf("the newest code must work: %v", err)
	}
}

func TestAccess_RateLimit_AppliesToKnownAndUnknownContactsAlike(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 11)
	stranger := "nadie-" + uniqueDigits(t, 8) + "@example.test"

	for _, contact := range []string{email, stranger} {
		ip := freshIP(t)
		for i := 0; i < customeraccess.AccessRequestsPerContact; i++ {
			if _, err := f.service.RequestCode(ctx, accessSlugUno, contact, ip); err != nil {
				t.Fatalf("request %d for %q: %v", i+1, contact, err)
			}
		}
		_, err := f.service.RequestCode(ctx, accessSlugUno, contact, ip)
		appErr, ok := apperr.As(err)
		if !ok || appErr.Kind != apperr.KindRateLimited || appErr.RetryAfterSeconds < 1 {
			t.Fatalf("request %d for %q must be rate limited with Retry-After, got %v", customeraccess.AccessRequestsPerContact+1, contact, err)
		}
	}
}

func TestAccess_RateLimitPerIP_CountsAcrossContacts(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	ip := freshIP(t)

	for i := 0; i < customeraccess.AccessRequestsPerIP; i++ {
		contact := fmt.Sprintf("ip-%d-%s@example.test", i, uniqueDigits(t, 8))
		if _, err := f.service.RequestCode(ctx, accessSlugUno, contact, ip); err != nil {
			t.Fatalf("request %d: %v", i+1, err)
		}
	}
	if _, err := f.service.RequestCode(ctx, accessSlugUno, "otro-"+uniqueDigits(t, 8)+"@example.test", ip); !isKind(err, apperr.KindRateLimited) {
		t.Fatalf("the IP limit must apply across contacts, got %v", err)
	}
	// Otra IP no queda afectada.
	if _, err := f.service.RequestCode(ctx, accessSlugUno, "otro-"+uniqueDigits(t, 8)+"@example.test", freshIP(t)); err != nil {
		t.Fatalf("another IP must not be limited: %v", err)
	}
}

func TestAccess_TenantIsolation_AContactOfShopOneIsNobodyInShopTwo(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 12)

	before := f.sender.count()
	if _, err := f.service.RequestCode(ctx, accessSlugDos, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode in the other shop: %v", err)
	}
	if f.sender.count() != before {
		t.Fatal("a customer of shop one must not receive a code through shop two")
	}

	// Un código de la barbería uno no abre nada por el slug de la dos.
	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode in shop one: %v", err)
	}
	code := f.sender.last(t).code
	if _, err := f.service.VerifyCode(ctx, accessSlugDos, email, code); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("a code must not verify against another shop, got %v", err)
	}
}

func TestAccess_UnknownSlug_IsNotFoundForBothOperations(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, _ := freshContact(t)
	if _, err := f.service.RequestCode(ctx, "no-existe-"+uniqueDigits(t, 6), email, freshIP(t)); !isKind(err, apperr.KindNotFound) {
		t.Fatalf("RequestCode: expected not found, got %v", err)
	}
	if _, err := f.service.VerifyCode(ctx, "no-existe-"+uniqueDigits(t, 6), email, "123456"); !isKind(err, apperr.KindNotFound) {
		t.Fatalf("VerifyCode: expected not found, got %v", err)
	}
}

func TestAccess_CancelledAppointmentsDoNotGetACode(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	appt := bookFor(t, f.db, email, phone, 13)
	err := f.db.InTenantTx(ctx, database.BarbershopID(accessShopUno), func(ctx context.Context, q database.Queries) error {
		_, err := q.Exec(ctx, `UPDATE appointment SET status = 'cancelled_by_customer', resolved_at = now() WHERE id = $1`, appt.ID)
		return err
	})
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	before := f.sender.count()
	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	if f.sender.count() != before {
		t.Fatal("a customer without an upcoming confirmed appointment must not receive a code")
	}
}

func TestAccess_SeveralAppointments_GetOneAccessEach(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	first := bookFor(t, f.db, email, phone, 14)
	bookWith(t, f.db, booking.CustomerInput{ExistingID: &first.CustomerID}, 15)

	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	verified, err := f.service.VerifyCode(ctx, accessSlugUno, email, f.sender.last(t).code)
	if err != nil {
		t.Fatalf("VerifyCode: %v", err)
	}
	if len(verified.Appointments) != 2 {
		t.Fatalf("expected an access per appointment, got %d", len(verified.Appointments))
	}
	if verified.Appointments[0].AccessToken == verified.Appointments[1].AccessToken {
		t.Fatal("each appointment needs its own access")
	}
	if !verified.Appointments[0].StartsAt.Before(verified.Appointments[1].StartsAt) {
		t.Fatal("appointments must come soonest first")
	}
}

func TestAccess_ChallengeTable_StoresNoPlaintextAndHidesRowsFromOtherTenants(t *testing.T) {
	f := newAccessFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 16)
	if _, err := f.service.RequestCode(ctx, accessSlugUno, email, freshIP(t)); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	code := f.sender.last(t).code

	var leaked int
	err := f.db.InTenantTx(ctx, database.BarbershopID(accessShopUno), func(ctx context.Context, q database.Queries) error {
		return q.QueryRow(ctx,
			`SELECT count(*) FROM customer_access_challenge
			  WHERE contact_hash = $1 OR ip_hash = $1 OR code_hash = $1 OR contact_hash LIKE '%' || $2 || '%'`,
			email, code).Scan(&leaked)
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if leaked != 0 {
		t.Fatal("the table must hold only HMACs, never the contact, the IP or the code")
	}

	var visibleToOtherTenant int
	err = f.db.InTenantTx(ctx, database.BarbershopID(accessShopDos), func(ctx context.Context, q database.Queries) error {
		return q.QueryRow(ctx, `SELECT count(*) FROM customer_access_challenge WHERE barbershop_id = $1`, accessShopUno).Scan(&visibleToOtherTenant)
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if visibleToOtherTenant != 0 {
		t.Fatal("RLS must hide shop one's challenges from shop two")
	}
}
