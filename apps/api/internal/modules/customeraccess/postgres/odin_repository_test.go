package postgres_test

// Pruebas de integración de HU-106 (acceso que pide Odin por WhatsApp) contra
// PostgreSQL REAL con dos negocios. Solo el envío y el reloj son dobles; la
// política de cancelar y reprogramar es la real de booking, como en el arranque.

import (
	"context"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/booking"
	"nava-agenda/internal/modules/customeraccess"
	customeraccesspostgres "nava-agenda/internal/modules/customeraccess/postgres"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/database"
)

func realPolicy() customeraccess.ChangePolicy {
	return customeraccess.ChangePolicy{
		CanCancel: func(startsAt, now time.Time, deadline int, late bool) bool {
			return booking.CustomerCancellationPolicy{DeadlineMinutes: deadline, LateClientAllowed: late}.Evaluate(startsAt, now, "") == nil
		},
		CanReschedule: func(startsAt, now time.Time, deadline, done int) bool {
			return booking.CustomerReschedulePolicy{DeadlineMinutes: deadline}.Evaluate(startsAt, now) == nil &&
				booking.EvaluateCustomerRescheduleCount(done) == nil
		},
	}
}

type refFixture struct {
	*accessFixture
	refs *customeraccess.RefService
}

func newRefFixture(t *testing.T) *refFixture {
	t.Helper()
	return newRefFixtureWith(t, realPolicy(), true)
}

func newRefFixtureWith(t *testing.T, policy customeraccess.ChangePolicy, whatsappReady bool) *refFixture {
	t.Helper()
	f := newAccessFixture(t)
	return &refFixture{
		accessFixture: f,
		refs: customeraccess.NewRefService(
			customeraccesspostgres.NewAccessRepository(f.db), f.sender,
			customeraccess.CryptoCodeGenerator{}, f.clock, accessSecret, policy, whatsappReady, nil,
		).WithSynchronousDelivery(),
	}
}

func (f *refFixture) onlyAppointment(t *testing.T, phone string) customeraccess.OdinAppointment {
	t.Helper()
	list, err := f.refs.Lookup(context.Background(), accessSlugUno, phone)
	if err != nil || len(list) != 1 {
		t.Fatalf("Lookup: %v / %d appointments", err, len(list))
	}
	return list[0]
}

func TestRef_Lookup_ListsOnlyThePhonesUpcomingConfirmedAppointments(t *testing.T) {
	f := newRefFixture(t)
	email, phone := freshContact(t)
	appt := bookFor(t, f.db, email, phone, 5)

	got := f.onlyAppointment(t, phone)
	if !got.StartsAt.Equal(appt.StartsAt) || got.ServiceName == "" || got.ProfessionalName == "" {
		t.Fatalf("unexpected appointment %+v", got)
	}
	if !got.CanCancel || !got.CanReschedule {
		t.Fatalf("a far-off appointment must be changeable, got %+v", got)
	}
	if got.Ref == "" || strings.Contains(got.Ref, appt.ID) {
		t.Fatalf("the reference must be opaque, got %q", got.Ref)
	}

	// Un teléfono sin turnos recibe una lista vacía; el negocio dos no ve nada de la uno.
	for slug, number := range map[string]string{accessSlugUno: "+573" + uniqueDigits(t, 9), accessSlugDos: phone} {
		list, err := f.refs.Lookup(context.Background(), slug, number)
		if err != nil || len(list) != 0 {
			t.Fatalf("%s: expected an empty list, got %v / %v", slug, list, err)
		}
	}
}

func TestRef_Lookup_FlagsFollowThePolicy(t *testing.T) {
	policy := customeraccess.ChangePolicy{
		CanCancel:     func(time.Time, time.Time, int, bool) bool { return true },
		CanReschedule: func(time.Time, time.Time, int, int) bool { return false },
	}
	f := newRefFixtureWith(t, policy, true)
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)

	got := f.onlyAppointment(t, phone)
	if !got.CanCancel || got.CanReschedule {
		t.Fatalf("flags must come from the injected policy, got %+v", got)
	}
}

func TestRef_Lookup_RejectsAnEmailAndAnUnknownShop(t *testing.T) {
	f := newRefFixture(t)
	if _, err := f.refs.Lookup(context.Background(), accessSlugUno, "alguien@example.test"); !isKind(err, apperr.KindValidation) {
		t.Fatalf("an email is not a phone, got %v", err)
	}
	if _, err := f.refs.Lookup(context.Background(), "no-existe-hu106", "+573001234567"); !isKind(err, apperr.KindNotFound) {
		t.Fatalf("an unknown shop must be not found, got %v", err)
	}
}

func TestRef_Flow_SendsTheCodeByWhatsAppAndIssuesOneAccessForThatAppointment(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	first := bookFor(t, f.db, email, phone, 5)
	bookWith(t, f.db, booking.CustomerInput{ExistingID: &first.CustomerID}, 6) // otro turno del mismo cliente: no debe recibir acceso
	list, err := f.refs.Lookup(ctx, accessSlugUno, phone)
	if err != nil || len(list) != 2 {
		t.Fatalf("Lookup: %v / %d", err, len(list))
	}
	var target customeraccess.OdinAppointment
	for _, a := range list {
		if a.StartsAt.Equal(first.StartsAt) {
			target = a
		}
	}

	accepted, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel)
	if err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	sent := f.sender.last(t)
	if sent.channel != "whatsapp" || sent.destination != phone {
		t.Fatalf("the code must go by WhatsApp to the phone, got %+v", sent)
	}
	if accepted.AccessRef == "" || !accepted.ExpiresAt.After(f.clock.Now()) {
		t.Fatalf("unexpected acceptance %+v", accepted)
	}

	verified, err := f.refs.VerifyRef(ctx, accessSlugUno, accepted.AccessRef, sent.code)
	if err != nil {
		t.Fatalf("VerifyRef: %v", err)
	}
	if verified.Purpose != customeraccess.PurposeCancel {
		t.Fatalf("expected the purpose to travel, got %q", verified.Purpose)
	}
	view, err := f.reader.GetAppointmentByToken(ctx, verified.AccessToken)
	if err != nil {
		t.Fatalf("the access must open the appointment: %v", err)
	}
	if !view.StartsAt.Equal(first.StartsAt) {
		t.Fatalf("the access opened another appointment: %v vs %v", view.StartsAt, first.StartsAt)
	}

	// Un solo uso, y el mismo código tampoco sirve en la pantalla general.
	if _, err := f.refs.VerifyRef(ctx, accessSlugUno, accepted.AccessRef, sent.code); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("a used code must be rejected, got %v", err)
	}
	if _, err := f.service.VerifyCode(ctx, accessSlugUno, phone, sent.code); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("a code asked by Odin must not verify in the general flow (CA-106-06), got %v", err)
	}
}

func TestRef_GeneralCode_DoesNotVerifyThroughAReference(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)

	// El reto de Odin y el general conviven: cada código abre solo lo suyo.
	accepted, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeReschedule)
	if err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	refCode := f.sender.last(t).code
	if _, err := f.service.RequestCode(ctx, accessSlugUno, phone, freshIP(t)); err != nil {
		t.Fatalf("general RequestCode: %v", err)
	}
	generalCode := f.sender.last(t).code
	if generalCode != refCode {
		if _, err := f.refs.VerifyRef(ctx, accessSlugUno, accepted.AccessRef, generalCode); !isKind(err, apperr.KindUnauthorized) {
			t.Fatalf("the general code must not open the reference, got %v", err)
		}
	}
	if _, err := f.service.VerifyCode(ctx, accessSlugUno, phone, generalCode); err != nil {
		t.Fatalf("the general flow must keep working: %v", err)
	}
}

func TestRef_AppointmentOfAnotherPhoneOrAnIneligiblePurposeIsNotAvailable(t *testing.T) {
	ctx := context.Background()
	f := newRefFixtureWith(t, customeraccess.ChangePolicy{
		CanCancel:     func(time.Time, time.Time, int, bool) bool { return false },
		CanReschedule: func(time.Time, time.Time, int, int) bool { return true },
	}, true)
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)
	_, otherPhone := freshContact(t)
	before := f.sender.count()

	if _, err := f.refs.RequestCode(ctx, accessSlugUno, otherPhone, target.Ref, customeraccess.PurposeReschedule); !isKind(err, apperr.KindAppointmentNotAvailable) {
		t.Fatalf("a reference of another phone must be not available, got %v", err)
	}
	if _, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel); !isKind(err, apperr.KindAppointmentNotAvailable) {
		t.Fatalf("a purpose the policy rejects must be not available, got %v", err)
	}
	if _, err := f.refs.RequestCode(ctx, accessSlugUno, phone, "referencia-inventada", customeraccess.PurposeReschedule); !isKind(err, apperr.KindAppointmentNotAvailable) {
		t.Fatalf("a made-up reference must be not available, got %v", err)
	}
	if _, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, "borrar"); !isKind(err, apperr.KindValidation) {
		t.Fatalf("an unknown purpose is a validation error, got %v", err)
	}
	if f.sender.count() != before {
		t.Fatal("a rejected request must not send anything")
	}
}

// DEC-181: sin propósito el reto queda en `manage`, se guarda así en la tabla y viaja a
// la verificación; la persona elige después en el paso 03.
func TestRef_Manage_IsTheDefaultAndTravelsToTheVerification(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)

	accepted, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, "")
	if err != nil || accepted.Purpose != customeraccess.PurposeManage {
		t.Fatalf("an omitted purpose must be manage: %+v / %v", accepted, err)
	}
	verified, err := f.refs.VerifyRef(ctx, accessSlugUno, accepted.AccessRef, f.sender.last(t).code)
	if err != nil || verified.Purpose != customeraccess.PurposeManage {
		t.Fatalf("manage must travel to the verification: %+v / %v", verified, err)
	}
	if _, err := f.reader.GetAppointmentByToken(ctx, verified.AccessToken); err != nil {
		t.Fatalf("the access must open the appointment: %v", err)
	}
}

// DEC-181: `manage` basta con que el turno admita una de las dos acciones, y se rechaza
// igual que los demás cuando no admite ninguna.
func TestRef_Manage_NeedsAtLeastOneAction(t *testing.T) {
	ctx := context.Background()
	never := func(time.Time, time.Time, int, bool) bool { return false }
	onlyReschedule := newRefFixtureWith(t, customeraccess.ChangePolicy{
		CanCancel:     never,
		CanReschedule: func(time.Time, time.Time, int, int) bool { return true },
	}, true)
	email, phone := freshContact(t)
	bookFor(t, onlyReschedule.db, email, phone, 5)
	if _, err := onlyReschedule.refs.RequestCode(ctx, accessSlugUno, phone,
		onlyReschedule.onlyAppointment(t, phone).Ref, customeraccess.PurposeManage); err != nil {
		t.Fatalf("one available action is enough for manage: %v", err)
	}

	neither := newRefFixtureWith(t, customeraccess.ChangePolicy{
		CanCancel:     never,
		CanReschedule: func(time.Time, time.Time, int, int) bool { return false },
	}, true)
	email, phone = freshContact(t)
	bookFor(t, neither.db, email, phone, 5)
	before := neither.sender.count()
	if _, err := neither.refs.RequestCode(ctx, accessSlugUno, phone,
		neither.onlyAppointment(t, phone).Ref, customeraccess.PurposeManage); !isKind(err, apperr.KindAppointmentNotAvailable) {
		t.Fatalf("an appointment with no available action must be not available, got %v", err)
	}
	if neither.sender.count() != before {
		t.Fatal("a rejected request must not send anything")
	}
}

func TestRef_ReferenceOfShopOneIsUselessInShopTwo(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	appt := bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)

	if _, err := f.refs.RequestCode(ctx, accessSlugDos, phone, target.Ref, customeraccess.PurposeReschedule); !isKind(err, apperr.KindAppointmentNotAvailable) {
		t.Fatalf("the reference is bound to its shop, got %v", err)
	}
	// Aun con el identificador del turno en la mano, RLS no deja ver el turno de otro negocio.
	repo := customeraccesspostgres.NewAccessRepository(f.db)
	outcome, err := repo.RequestRefChallenge(ctx, customeraccess.RefChallengeRequest{
		Slug: accessSlugDos, Contact: customeraccess.Contact{Channel: customeraccess.ChannelWhatsApp, Value: phone},
		ContactHash: strings.Repeat("a", 64), ServiceHash: strings.Repeat("b", 64), CodeHash: strings.Repeat("c", 64),
		AccessRefHash: strings.Repeat("d", 64), AppointmentID: appt.ID, Purpose: customeraccess.PurposeCancel,
		Now: f.clock.Now(), ExpiresAt: f.clock.Now().Add(time.Minute),
		Eligible: func(customeraccess.AppointmentCandidate) bool { return true },
	})
	if err != nil || !outcome.BusinessFound || outcome.Available {
		t.Fatalf("shop two must not see shop one's appointment: %+v / %v", outcome, err)
	}

	accepted, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeReschedule)
	if err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	if _, err := f.refs.VerifyRef(ctx, accessSlugDos, accepted.AccessRef, f.sender.last(t).code); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("an access reference must not verify against another shop, got %v", err)
	}
}

func TestRef_WrongCodesExhaustTheChallengeAndAnExpiredOneIsRejected(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)
	accepted, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel)
	if err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	good := f.sender.last(t).code
	wrong := "000000"
	if good == wrong {
		wrong = "000001"
	}
	for i := 0; i < customeraccess.AccessCodeMaxAttempts; i++ {
		if _, err := f.refs.VerifyRef(ctx, accessSlugUno, accepted.AccessRef, wrong); !isKind(err, apperr.KindUnauthorized) {
			t.Fatalf("attempt %d: expected unauthorized, got %v", i+1, err)
		}
	}
	if _, err := f.refs.VerifyRef(ctx, accessSlugUno, accepted.AccessRef, good); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("after %d wrong attempts the right code must no longer work, got %v", customeraccess.AccessCodeMaxAttempts, err)
	}

	// Un reto nuevo vence a los 10 minutos.
	_, err = f.refs.RequestCode(ctx, accessSlugUno, phone, f.onlyAppointment(t, phone).Ref, customeraccess.PurposeReschedule)
	if err != nil {
		t.Fatalf("second RequestCode: %v", err)
	}
	code := f.sender.last(t).code
	f.clock.advance(customeraccess.AccessCodeTTL + time.Second)
	// La referencia nueva ya caducó junto con el reto; basta comprobar que el viejo no revive.
	if _, err := f.refs.VerifyRef(ctx, accessSlugUno, accepted.AccessRef, code); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("an expired challenge must be rejected, got %v", err)
	}
}

func TestRef_AskingAgainRetiresThePreviousReference(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)

	first, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel)
	if err != nil {
		t.Fatal(err)
	}
	firstCode := f.sender.last(t).code
	second, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeReschedule)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.refs.VerifyRef(ctx, accessSlugUno, first.AccessRef, firstCode); !isKind(err, apperr.KindUnauthorized) {
		t.Fatalf("the previous reference must be useless once another is asked, got %v", err)
	}
	verified, err := f.refs.VerifyRef(ctx, accessSlugUno, second.AccessRef, f.sender.last(t).code)
	if err != nil || verified.Purpose != customeraccess.PurposeReschedule {
		t.Fatalf("the newest reference must work with its own purpose: %+v / %v", verified, err)
	}
}

func TestRef_RateLimit_IsSharedWithTheGeneralScreen(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)

	// Dos solicitudes de la pantalla general y una de Odin agotan las 3 del contacto.
	for i := 0; i < 2; i++ {
		if _, err := f.service.RequestCode(ctx, accessSlugUno, phone, freshIP(t)); err != nil {
			t.Fatalf("general RequestCode %d: %v", i, err)
		}
	}
	if _, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel); err != nil {
		t.Fatalf("the third request must still pass: %v", err)
	}
	before := f.sender.count()
	_, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel)
	limited, ok := apperr.As(err)
	if !ok || limited.Kind != apperr.KindRateLimited || limited.RetryAfterSeconds < 1 {
		t.Fatalf("the fourth request must be rate limited with a Retry-After, got %v", err)
	}
	if f.sender.count() != before {
		t.Fatal("a rate-limited request must not send a code")
	}
}

func TestRef_ServiceCapPerBusinessApplies(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	appt := bookFor(t, f.db, email, phone, 5)
	serviceHash := strings.Repeat("e", 63) + uniqueDigits(t, 1)

	// Se llena el tope del servicio con solicitudes de otros contactos.
	err := f.db.InTenantTx(ctx, database.BusinessID(accessShopUno), func(ctx context.Context, q database.Queries) error {
		for i := 0; i < customeraccess.ServiceRequestsPerBusiness; i++ {
			if _, err := q.Exec(ctx,
				`INSERT INTO customer_access_challenge (business_id, channel, contact_hash, ip_hash, created_at, expires_at)
				 VALUES ($1, 'whatsapp', $2, $3, $4, $5)`,
				accessShopUno, strings.Repeat("f", 63)+uniqueDigits(t, 1), serviceHash, f.clock.Now(), f.clock.Now().Add(10*time.Minute)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	repo := customeraccesspostgres.NewAccessRepository(f.db)
	outcome, err := repo.RequestRefChallenge(ctx, customeraccess.RefChallengeRequest{
		Slug: accessSlugUno, Contact: customeraccess.Contact{Channel: customeraccess.ChannelWhatsApp, Value: phone},
		ContactHash: strings.Repeat("1", 63) + uniqueDigits(t, 1), ServiceHash: serviceHash, CodeHash: strings.Repeat("2", 64),
		AccessRefHash: strings.Repeat("3", 63) + uniqueDigits(t, 1), AppointmentID: appt.ID, Purpose: customeraccess.PurposeCancel,
		Now: f.clock.Now(), ExpiresAt: f.clock.Now().Add(10 * time.Minute),
		Eligible: func(customeraccess.AppointmentCandidate) bool { return true },
	})
	if err != nil {
		t.Fatalf("RequestRefChallenge: %v", err)
	}
	if !outcome.RateLimited || outcome.RetryAfter <= 0 {
		t.Fatalf("the per-business service cap must apply, got %+v", outcome)
	}
}

func TestRef_WithoutWhatsAppConfigured_IsUnavailableAndSendsNothing(t *testing.T) {
	f := newRefFixtureWith(t, realPolicy(), false)
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)

	if _, err := f.refs.RequestCode(context.Background(), accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel); !isKind(err, apperr.KindUnavailable) {
		t.Fatalf("expected unavailable, got %v", err)
	}
	if f.sender.count() != 0 {
		t.Fatal("nothing must be sent without WhatsApp")
	}
}

func TestRef_Table_StoresNoPlainReference(t *testing.T) {
	f := newRefFixture(t)
	ctx := context.Background()
	email, phone := freshContact(t)
	bookFor(t, f.db, email, phone, 5)
	target := f.onlyAppointment(t, phone)
	accepted, err := f.refs.RequestCode(ctx, accessSlugUno, phone, target.Ref, customeraccess.PurposeCancel)
	if err != nil {
		t.Fatal(err)
	}
	var leaked int
	err = f.db.InTenantTx(ctx, database.BusinessID(accessShopUno), func(ctx context.Context, q database.Queries) error {
		return q.QueryRow(ctx, `SELECT count(*) FROM customer_access_challenge WHERE access_ref_hash = $1`, accepted.AccessRef).Scan(&leaked)
	})
	if err != nil || leaked != 0 {
		t.Fatalf("the reference must be stored only as a hash: %d / %v", leaked, err)
	}
}
