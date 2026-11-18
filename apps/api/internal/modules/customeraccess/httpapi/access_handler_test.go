package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/modules/customeraccess"
	"nava-agenda/internal/modules/customeraccess/httpapi"
	"nava-agenda/internal/platform/clientip"
	"nava-agenda/internal/platform/httpserver"
)

// fakeAccessRepo decide el resultado sin base de datos: aquí solo se prueba la
// traducción a HTTP; la regla vive en el servicio y en postgres/.
type fakeAccessRepo struct {
	challenge customeraccess.ChallengeOutcome
	verify    customeraccess.VerifyOutcome
}

func (f fakeAccessRepo) RequestChallenge(context.Context, customeraccess.ChallengeRequest) (customeraccess.ChallengeOutcome, error) {
	return f.challenge, nil
}

func (f fakeAccessRepo) VerifyChallenge(context.Context, customeraccess.VerifyRequest, customeraccess.TokenMinter) (customeraccess.VerifyOutcome, error) {
	return f.verify, nil
}

type discardSender struct{ sent int }

func (d *discardSender) SendCode(context.Context, string, string, string) error { d.sent++; return nil }

type fixedClock struct{}

func (fixedClock) Now() time.Time { return time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC) }

func accessService(repo fakeAccessRepo, sender *discardSender) *customeraccess.AccessService {
	return customeraccess.NewAccessService(repo, sender, customeraccess.CryptoCodeGenerator{},
		fixedClock{}, []byte("secreto-de-prueba"), nil).WithSynchronousDelivery()
}

func postJSON(h http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/public/businesses/demo/customer-access/x", strings.NewReader(body))
	req.RemoteAddr = "203.0.113.7:4444"
	req = httpserver.RequestWithURLParam(req, "slug", "demo")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRequestAccessCode_KnownAndUnknownContactsGetTheSameResponse(t *testing.T) {
	known := &discardSender{}
	stranger := &discardSender{}
	knownRec := postJSON(httpapi.NewRequestAccessCodeHandler(
		accessService(fakeAccessRepo{challenge: customeraccess.ChallengeOutcome{BusinessFound: true, Matched: true}}, known),
		clientip.TrustedProxies{}), `{"contact":"ana@example.test"}`)
	strangerRec := postJSON(httpapi.NewRequestAccessCodeHandler(
		accessService(fakeAccessRepo{challenge: customeraccess.ChallengeOutcome{BusinessFound: true}}, stranger),
		clientip.TrustedProxies{}), `{"contact":"nadie@example.test"}`)

	if knownRec.Code != http.StatusAccepted || strangerRec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for both, got %d and %d", knownRec.Code, strangerRec.Code)
	}
	if knownRec.Body.String() != strangerRec.Body.String() {
		t.Fatalf("bodies must be byte-identical: %q vs %q", knownRec.Body.String(), strangerRec.Body.String())
	}
	if known.sent != 1 || stranger.sent != 0 {
		t.Fatalf("only the matched contact receives a code, got %d and %d", known.sent, stranger.sent)
	}
	if got := knownRec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	var body httpapi.AccessChallengeResponse
	if err := json.Unmarshal(knownRec.Body.Bytes(), &body); err != nil || body.ExpiresInSeconds != 600 || body.ResendAfterSeconds != 60 {
		t.Fatalf("unexpected body %q (%v)", knownRec.Body.String(), err)
	}
}

func TestRequestAccessCode_RateLimited_Is429WithRetryAfter(t *testing.T) {
	h := httpapi.NewRequestAccessCodeHandler(accessService(fakeAccessRepo{
		challenge: customeraccess.ChallengeOutcome{BusinessFound: true, RateLimited: true, RetryAfter: 90*time.Second + 300*time.Millisecond},
	}, &discardSender{}), clientip.TrustedProxies{})
	rec := postJSON(h, `{"contact":"ana@example.test"}`)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "91" {
		t.Fatalf("Retry-After = %q, want 91", got)
	}
	if !strings.Contains(rec.Body.String(), `"code":"rate-limited"`) {
		t.Fatalf("expected the rate-limited problem, got %s", rec.Body.String())
	}
}

func TestRequestAccessCode_RejectsBadBodiesBeforeTouchingTheRepository(t *testing.T) {
	h := httpapi.NewRequestAccessCodeHandler(accessService(fakeAccessRepo{}, &discardSender{}), clientip.TrustedProxies{})
	for name, body := range map[string]string{
		"no es JSON":          `no`,
		"campo desconocido":   `{"contact":"ana@example.test","extra":1}`,
		"dos objetos":         `{"contact":"ana@example.test"}{}`,
		"contacto vacío":      `{"contact":""}`,
		"contacto sin forma":  `{"contact":"@@"}`,
		"contacto de números": `{"contact":"12"}`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := postJSON(h, body)
			if rec.Code != http.StatusBadRequest && rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected 400/422, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestRequestAccessCode_UnknownBusiness_Is404(t *testing.T) {
	h := httpapi.NewRequestAccessCodeHandler(accessService(fakeAccessRepo{}, &discardSender{}), clientip.TrustedProxies{})
	if rec := postJSON(h, `{"contact":"ana@example.test"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestVerifyAccessCode_Valid_ReturnsTheAccessesOnceAndNoStore(t *testing.T) {
	starts := time.Date(2027, 3, 15, 15, 0, 0, 0, time.UTC)
	h := httpapi.NewVerifyAccessCodeHandler(accessService(fakeAccessRepo{verify: customeraccess.VerifyOutcome{
		BusinessFound: true, Valid: true, Timezone: "America/Bogota",
		Appointments: []customeraccess.AccessAppointment{{AccessToken: "tok-1", StartsAt: starts, ServiceName: "Corte", ProfessionalName: "Juan"}},
	}}, &discardSender{}))
	rec := postJSON(h, `{"contact":"ana@example.test","code":"123456"}`)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected 200 no-store, got %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	var out httpapi.AccessVerifyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Timezone != "America/Bogota" || len(out.Appointments) != 1 || out.Appointments[0].AccessToken != "tok-1" || !out.Appointments[0].StartsAt.Equal(starts) {
		t.Fatalf("unexpected body %s", rec.Body.String())
	}
}

func TestVerifyAccessCode_AnyCodeFailure_IsTheSame401(t *testing.T) {
	h := httpapi.NewVerifyAccessCodeHandler(accessService(fakeAccessRepo{verify: customeraccess.VerifyOutcome{BusinessFound: true}}, &discardSender{}))
	rec := postJSON(h, `{"contact":"ana@example.test","code":"123456"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "ana@example.test") || strings.Contains(rec.Body.String(), "123456") {
		t.Fatal("the error must not echo the contact or the code")
	}
}

func TestVerifyAccessCode_MalformedCodeIsAValidationErrorBeforeAnyLookup(t *testing.T) {
	h := httpapi.NewVerifyAccessCodeHandler(accessService(fakeAccessRepo{verify: customeraccess.VerifyOutcome{BusinessFound: true, Valid: true}}, &discardSender{}))
	for _, code := range []string{"", "12345", "abcdef", "1234567"} {
		rec := postJSON(h, `{"contact":"ana@example.test","code":"`+code+`"}`)
		if rec.Code != http.StatusUnprocessableEntity && rec.Code != http.StatusBadRequest {
			t.Fatalf("code %q: expected 4xx validation, got %d", code, rec.Code)
		}
	}
}
