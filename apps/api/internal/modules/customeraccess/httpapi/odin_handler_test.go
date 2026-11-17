package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"system-barbershop/internal/modules/customeraccess"
	"system-barbershop/internal/modules/customeraccess/httpapi"
)

// fakeOdinRepo decide el resultado sin base de datos: aquí solo se prueba la
// traducción a HTTP y la credencial de servicio; las reglas viven en el servicio y
// en postgres/.
type fakeOdinRepo struct {
	lookup    customeraccess.LookupOutcome
	challenge customeraccess.RefChallengeOutcome
	verify    customeraccess.VerifyRefOutcome
	lastReq   customeraccess.RefChallengeRequest
}

func (f *fakeOdinRepo) LookupUpcoming(context.Context, string, string, time.Time) (customeraccess.LookupOutcome, error) {
	return f.lookup, nil
}

func (f *fakeOdinRepo) RequestRefChallenge(_ context.Context, req customeraccess.RefChallengeRequest) (customeraccess.RefChallengeOutcome, error) {
	f.lastReq = req
	return f.challenge, nil
}

func (f *fakeOdinRepo) VerifyRef(context.Context, customeraccess.VerifyRefRequest, customeraccess.TokenMinter) (customeraccess.VerifyRefOutcome, error) {
	return f.verify, nil
}

func refService(repo *fakeOdinRepo, sender *discardSender, whatsapp bool) *customeraccess.RefService {
	policy := customeraccess.ChangePolicy{
		CanCancel:     func(time.Time, time.Time, int, bool) bool { return true },
		CanReschedule: func(time.Time, time.Time, int, int) bool { return false },
	}
	return customeraccess.NewRefService(repo, sender, customeraccess.CryptoCodeGenerator{}, fixedClock{},
		[]byte("secreto-de-prueba"), policy, whatsapp, nil).WithSynchronousDelivery()
}

const goodPhone = "+573001234567"

func TestRequireServiceToken_OnlyTheRightSecretPasses(t *testing.T) {
	const secret = "un-secreto-de-servicio-largo-de-prueba-0123"
	reached := 0
	h := httpapi.RequireServiceToken(secret)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached++
		w.WriteHeader(http.StatusNoContent)
	}))

	call := func(header string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/integrations/odin/x", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	if rec := call("Bearer " + secret); rec.Code != http.StatusNoContent {
		t.Fatalf("the right secret must pass, got %d", rec.Code)
	}
	if rec := call("bearer " + secret); rec.Code != http.StatusNoContent {
		t.Fatalf("the scheme is case-insensitive, got %d", rec.Code)
	}
	reachedBefore := reached
	for name, header := range map[string]string{
		"sin cabecera":      "",
		"otro secreto":      "Bearer otro-secreto-distinto-de-prueba-9999",
		"sin esquema":       secret,
		"otro esquema":      "Basic " + secret,
		"secreto parcial":   "Bearer " + secret[:10],
		"secreto de más":    "Bearer " + secret + "x",
		"esquema sin valor": "Bearer",
	} {
		rec := call(header)
		if rec.Code != http.StatusUnauthorized || rec.Header().Get("WWW-Authenticate") != "Bearer" {
			t.Errorf("%s: expected 401 with WWW-Authenticate, got %d %q", name, rec.Code, rec.Header().Get("WWW-Authenticate"))
		}
		if !strings.Contains(rec.Body.String(), `"code":"unauthorized"`) || strings.Contains(rec.Body.String(), secret) {
			t.Errorf("%s: unexpected body %s", name, rec.Body.String())
		}
	}
	if reached != reachedBefore {
		t.Fatal("a wrong credential must never reach the handler")
	}
}

func TestRequireServiceToken_AnEmptySecretRejectsEverything(t *testing.T) {
	h := httpapi.RequireServiceToken("")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("must not reach the handler")
	}))
	for _, header := range []string{"", "Bearer ", "Bearer x"} {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		req.Header.Set("Authorization", header)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("header %q: expected 401, got %d", header, rec.Code)
		}
	}
}

func post(h http.Handler, body string) *httptest.ResponseRecorder {
	return postJSON(h, body)
}

func TestOdinLookup_ListsAppointmentsWithoutInternalIDs(t *testing.T) {
	repo := &fakeOdinRepo{lookup: customeraccess.LookupOutcome{BarbershopFound: true, Candidates: []customeraccess.AppointmentCandidate{{
		ID: "0b7e3c52-9a4d-4f10-8c6e-1d2a3b4c5d6e", StartsAt: time.Date(2027, 3, 2, 15, 0, 0, 0, time.UTC),
		ServiceName: "Corte Vbras", BarberName: "Jhonner Bustamante",
	}}}}
	rec := post(httpapi.NewOdinLookupHandler(refService(repo, &discardSender{}, true)), `{"phone":"`+goodPhone+`"}`)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected 200 no-store, got %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	if strings.Contains(rec.Body.String(), "0b7e3c52") {
		t.Fatalf("the internal appointment id must never leave the server: %s", rec.Body.String())
	}
	var body httpapi.OdinLookupResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Appointments) != 1 {
		t.Fatalf("unexpected body %s (%v)", rec.Body.String(), err)
	}
	got := body.Appointments[0]
	if got.AppointmentRef == "" || len(got.AppointmentRef) > 128 || !got.CanCancel || got.CanReschedule || got.ServiceName != "Corte Vbras" {
		t.Fatalf("unexpected appointment %+v", got)
	}
}

func TestOdinLookup_EmptyListAndErrors(t *testing.T) {
	empty := post(httpapi.NewOdinLookupHandler(refService(&fakeOdinRepo{lookup: customeraccess.LookupOutcome{BarbershopFound: true}}, &discardSender{}, true)), `{"phone":"`+goodPhone+`"}`)
	if empty.Code != http.StatusOK || !strings.Contains(empty.Body.String(), `"appointments":[]`) {
		t.Fatalf("an empty result must be an empty list, got %d %s", empty.Code, empty.Body.String())
	}
	if rec := post(httpapi.NewOdinLookupHandler(refService(&fakeOdinRepo{}, &discardSender{}, true)), `{"phone":"`+goodPhone+`"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("an unknown shop must be 404, got %d", rec.Code)
	}
	h := httpapi.NewOdinLookupHandler(refService(&fakeOdinRepo{}, &discardSender{}, true))
	for name, body := range map[string]string{
		"un correo":         `{"phone":"ana@example.test"}`,
		"teléfono inválido": `{"phone":"12"}`,
		"vacío":             `{"phone":""}`,
	} {
		if rec := post(h, body); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: expected 422, got %d", name, rec.Code)
		}
	}
	for name, body := range map[string]string{"no es JSON": `no`, "campo desconocido": `{"phone":"` + goodPhone + `","x":1}`} {
		if rec := post(h, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d", name, rec.Code)
		}
	}
}

func validRef(t *testing.T) string {
	t.Helper()
	repo := &fakeOdinRepo{lookup: customeraccess.LookupOutcome{BarbershopFound: true, Candidates: []customeraccess.AppointmentCandidate{{
		ID: "0b7e3c52-9a4d-4f10-8c6e-1d2a3b4c5d6e", StartsAt: time.Date(2027, 3, 2, 15, 0, 0, 0, time.UTC),
	}}}}
	rec := post(httpapi.NewOdinLookupHandler(refService(repo, &discardSender{}, true)), `{"phone":"`+goodPhone+`"}`)
	var body httpapi.OdinLookupResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Appointments) != 1 {
		t.Fatalf("lookup: %s (%v)", rec.Body.String(), err)
	}
	return body.Appointments[0].AppointmentRef
}

func TestOdinChallenge_CreatedSendsOnlyByWhatsApp(t *testing.T) {
	ref := validRef(t)
	repo := &fakeOdinRepo{challenge: customeraccess.RefChallengeOutcome{BarbershopFound: true, Available: true}}
	sender := &discardSender{}
	rec := post(httpapi.NewOdinChallengeHandler(refService(repo, sender, true)),
		`{"phone":"`+goodPhone+`","appointmentRef":"`+ref+`","purpose":"reschedule"}`)
	if rec.Code != http.StatusCreated || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected 201 no-store, got %d: %s", rec.Code, rec.Body.String())
	}
	var body httpapi.OdinChallengeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.AccessRef == "" || !body.ExpiresAt.After(fixedClock{}.Now()) {
		t.Fatalf("unexpected body %s (%v)", rec.Body.String(), err)
	}
	if sender.sent != 1 {
		t.Fatalf("exactly one code must be sent, got %d", sender.sent)
	}
	if repo.lastReq.Purpose != customeraccess.PurposeReschedule || repo.lastReq.Contact.Channel != customeraccess.ChannelWhatsApp {
		t.Fatalf("the challenge must carry the purpose and the WhatsApp channel: %+v", repo.lastReq)
	}
	if strings.Contains(rec.Body.String(), "code") {
		t.Fatalf("the response must never carry the code: %s", rec.Body.String())
	}
}

func TestOdinChallenge_ErrorsHaveTheirOwnStatuses(t *testing.T) {
	ref := validRef(t)
	body := `{"phone":"` + goodPhone + `","appointmentRef":"` + ref + `","purpose":"cancel"}`
	sender := &discardSender{}

	notAvailable := post(httpapi.NewOdinChallengeHandler(refService(&fakeOdinRepo{challenge: customeraccess.RefChallengeOutcome{BarbershopFound: true}}, sender, true)), body)
	if notAvailable.Code != http.StatusConflict || !strings.Contains(notAvailable.Body.String(), `"code":"appointment-not-available"`) {
		t.Fatalf("expected the uniform 409, got %d %s", notAvailable.Code, notAvailable.Body.String())
	}
	madeUp := post(httpapi.NewOdinChallengeHandler(refService(&fakeOdinRepo{}, sender, true)),
		`{"phone":"`+goodPhone+`","appointmentRef":"inventada","purpose":"cancel"}`)
	if madeUp.Code != http.StatusConflict || madeUp.Body.String() == "" {
		t.Fatalf("a made-up reference must be the same 409, got %d", madeUp.Code)
	}

	limited := post(httpapi.NewOdinChallengeHandler(refService(&fakeOdinRepo{challenge: customeraccess.RefChallengeOutcome{
		BarbershopFound: true, RateLimited: true, RetryAfter: 90*time.Second + 300*time.Millisecond,
	}}, sender, true)), body)
	if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "91" {
		t.Fatalf("expected 429 with Retry-After 91, got %d %q", limited.Code, limited.Header().Get("Retry-After"))
	}

	noWhatsApp := post(httpapi.NewOdinChallengeHandler(refService(&fakeOdinRepo{}, sender, false)), body)
	if noWhatsApp.Code != http.StatusServiceUnavailable || !strings.Contains(noWhatsApp.Body.String(), `"code":"service-unavailable"`) {
		t.Fatalf("expected 503 without WhatsApp, got %d", noWhatsApp.Code)
	}

	for name, b := range map[string]string{
		"propósito desconocido": `{"phone":"` + goodPhone + `","appointmentRef":"` + ref + `","purpose":"borrar"}`,
		"un correo":             `{"phone":"a@b.co","appointmentRef":"` + ref + `","purpose":"cancel"}`,
	} {
		if rec := post(httpapi.NewOdinChallengeHandler(refService(&fakeOdinRepo{}, sender, true)), b); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: expected 422, got %d", name, rec.Code)
		}
	}
	if sender.sent != 0 {
		t.Fatalf("no failed request may send a code, got %d", sender.sent)
	}
}

func TestVerifyRef_ValidAndUniformFailures(t *testing.T) {
	ok := post(httpapi.NewVerifyRefHandler(refService(&fakeOdinRepo{verify: customeraccess.VerifyRefOutcome{
		BarbershopFound: true, Valid: true, AccessToken: "tok-en-de-prueba", Purpose: customeraccess.PurposeCancel,
	}}, &discardSender{}, true)), `{"accessRef":"abc","code":"123456"}`)
	if ok.Code != http.StatusOK || ok.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected 200 no-store, got %d", ok.Code)
	}
	var body httpapi.VerifyRefResponse
	if err := json.Unmarshal(ok.Body.Bytes(), &body); err != nil || body.AccessToken != "tok-en-de-prueba" || body.Purpose != "cancel" {
		t.Fatalf("unexpected body %s (%v)", ok.Body.String(), err)
	}

	bad := post(httpapi.NewVerifyRefHandler(refService(&fakeOdinRepo{verify: customeraccess.VerifyRefOutcome{BarbershopFound: true}}, &discardSender{}, true)), `{"accessRef":"abc","code":"123456"}`)
	oversize := post(httpapi.NewVerifyRefHandler(refService(&fakeOdinRepo{}, &discardSender{}, true)), `{"accessRef":"`+strings.Repeat("x", 200)+`","code":"123456"}`)
	for name, rec := range map[string]*httptest.ResponseRecorder{"código inválido": bad, "referencia demasiado larga": oversize} {
		if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "código de verificación inválido o expirado") {
			t.Errorf("%s: expected the uniform 401, got %d %s", name, rec.Code, rec.Body.String())
		}
	}
	if rec := post(httpapi.NewVerifyRefHandler(refService(&fakeOdinRepo{}, &discardSender{}, true)), `{"accessRef":"abc","code":"12"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a malformed code is a validation error, got %d", rec.Code)
	}
	if rec := post(httpapi.NewVerifyRefHandler(refService(&fakeOdinRepo{}, &discardSender{}, true)), `{"accessRef":"abc","code":"123456"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("an unknown shop must be 404, got %d", rec.Code)
	}
}
