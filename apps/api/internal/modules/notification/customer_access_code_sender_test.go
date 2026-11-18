package notification_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nava-agenda/internal/modules/notification"
)

func newAccessSender(t *testing.T, resend *httptest.Server, meta *httptest.Server) notification.CustomerAccessCodeSender {
	t.Helper()
	var whatsapp interface {
		Send(ctx context.Context, phoneE164, code string) error
	}
	if meta != nil {
		whatsapp = newMetaSenderAgainstTestServer(t, meta, notification.MetaWhatsAppConfig{
			APIVersion: "v24.0", PhoneNumberID: "111", AccessToken: "meta-token",
			Mode: notification.MetaModeTemplate, TemplateName: "nava_codigo_turno", LanguageCode: "es_CO",
		})
	}
	client := resend.Client()
	client.Transport = redirectTransport{target: resend.URL}
	return notification.NewCustomerAccessCodeSender(notification.ResendEmailConfig{
		APIKey: "resend-key", FromAddress: "no-responder@barberia.test", Subject: "asunto que no aplica",
	}, whatsapp, client)
}

func TestCustomerAccessCodeSender_Email_UsesItsOwnSubjectAndCarriesTheCode(t *testing.T) {
	var body map[string]any
	resend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusOK)
	}))
	defer resend.Close()

	if err := newAccessSender(t, resend, nil).SendCode(context.Background(), "email", "ana@ejemplo.test", "482913"); err != nil {
		t.Fatalf("SendCode: %v", err)
	}
	if body["subject"] != "Tu código para cambiar tu turno" {
		t.Fatalf("unexpected subject %v", body["subject"])
	}
	text, _ := body["text"].(string)
	if !strings.Contains(text, "482913") || !strings.Contains(text, "10 minutos") {
		t.Fatalf("the email must carry the code and its lifetime, got %q", text)
	}
}

func TestCustomerAccessCodeSender_WhatsApp_SendsTheAuthenticationTemplate(t *testing.T) {
	var body map[string]any
	meta := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = w.Write([]byte(`{"messages":[{"id":"wamid.X"}]}`))
	}))
	defer meta.Close()
	resend := httptest.NewServer(http.NotFoundHandler())
	defer resend.Close()

	if err := newAccessSender(t, resend, meta).SendCode(context.Background(), "whatsapp", "+573001234567", "482913"); err != nil {
		t.Fatalf("SendCode: %v", err)
	}
	if body["to"] != "573001234567" {
		t.Fatalf("the number goes to Meta without the plus sign, got %v", body["to"])
	}
	template, _ := body["template"].(map[string]any)
	if template["name"] != "nava_codigo_turno" {
		t.Fatalf("expected the customer code template, got %v", template["name"])
	}
	if lang, _ := template["language"].(map[string]any); lang["code"] != "es_CO" {
		t.Fatalf("unexpected language %v", template["language"])
	}
	raw, _ := json.Marshal(template["components"])
	if strings.Count(string(raw), "482913") != 2 {
		t.Fatalf("body and copy-code button must both carry the code, got %s", raw)
	}
}

func TestCustomerAccessCodeSender_WhatsAppNotConfigured_FailsWithoutLeaking(t *testing.T) {
	resend := httptest.NewServer(http.NotFoundHandler())
	defer resend.Close()
	err := newAccessSender(t, resend, nil).SendCode(context.Background(), "whatsapp", "+573001234567", "482913")
	if err == nil {
		t.Fatal("expected an error when WhatsApp is not configured")
	}
	for _, secret := range []string{"+573001234567", "482913"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("the error must not leak %q: %v", secret, err)
		}
	}
}

func TestCustomerAccessCodeSender_UnknownChannel(t *testing.T) {
	resend := httptest.NewServer(http.NotFoundHandler())
	defer resend.Close()
	if err := newAccessSender(t, resend, nil).SendCode(context.Background(), "sms", "x", "482913"); !errors.Is(err, notification.ErrUnknownAccessChannel) {
		t.Fatalf("expected ErrUnknownAccessChannel, got %v", err)
	}
}
