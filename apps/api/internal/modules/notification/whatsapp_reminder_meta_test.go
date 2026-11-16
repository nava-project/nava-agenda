package notification_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"system-barbershop/internal/modules/notification"
)

func reminderSender(t *testing.T, srv *httptest.Server, recipients ...string) notification.MetaReminderSender {
	t.Helper()
	cfg := templateConfig()
	cfg.TestRecipients = recipients
	return notification.NewMetaReminderSender(newMetaSenderAgainstTestServer(t, srv, cfg), notification.MetaReminderConfig{})
}

func sendReminder(s notification.MetaReminderSender, phone string) error {
	return s.SendReminder(context.Background(), phone,
		"Laura", "Barbería\nNava   Demo", "hoy a las 3:30 p. m.", "Corte clásico", "Camilo Ortega")
}

func isPermanent(err error) bool {
	var p interface{ Permanent() bool }
	return errors.As(err, &p) && p.Permanent()
}

func TestMetaReminder_PostsTheApprovedTemplateWithFiveCleanParameters(t *testing.T) {
	var c capturedRequest
	srv := acceptingServer(t, &c)
	defer srv.Close()

	if err := sendReminder(reminderSender(t, srv), testRecipient); err != nil {
		t.Fatalf("SendReminder: %v", err)
	}
	if c.auth != "Bearer "+testToken || c.path != "/v24.0/1315949954943476/messages" {
		t.Fatalf("solicitud inesperada: auth=%q path=%q", c.auth, c.path)
	}
	raw, _ := json.Marshal(c.body)
	var msg struct {
		To       string `json:"to"`
		Type     string `json:"type"`
		Template struct {
			Name     string `json:"name"`
			Language struct {
				Code string `json:"code"`
			} `json:"language"`
			Components []struct {
				Type       string `json:"type"`
				Parameters []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"parameters"`
			} `json:"components"`
		} `json:"template"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatal(err)
	}
	if msg.To != "573001234567" || msg.Type != "template" ||
		msg.Template.Name != "nava_recordatorio_turno" || msg.Template.Language.Code != "es_CO" {
		t.Fatalf("plantilla inesperada: %+v", msg)
	}
	if len(msg.Template.Components) != 1 || msg.Template.Components[0].Type != "body" {
		t.Fatalf("solo cuerpo, sin botones: %+v", msg.Template.Components)
	}
	var got []string
	for _, p := range msg.Template.Components[0].Parameters {
		got = append(got, p.Text)
	}
	want := []string{"Laura", "Barbería Nava Demo", "hoy a las 3:30 p. m.", "Corte clásico", "Camilo Ortega"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("parámetros = %q, quiero %q (sin saltos ni espacios repetidos)", got, want)
	}
}

func TestMetaReminder_RecipientProblemsArePermanentAndNeverCallMeta(t *testing.T) {
	var c capturedRequest
	srv := acceptingServer(t, &c)
	defer srv.Close()

	if err := sendReminder(reminderSender(t, srv), "3001234567"); !isPermanent(err) || !errors.Is(err, notification.ErrInvalidRecipient) {
		t.Fatalf("número sin formato E.164: %v", err)
	}
	if err := sendReminder(reminderSender(t, srv, "+573009999999"), testRecipient); !isPermanent(err) ||
		!errors.Is(err, notification.ErrRecipientNotAuthorized) {
		t.Fatalf("fuera de la lista de pruebas: %v", err)
	}
	if c.calls.Load() != 0 {
		t.Fatalf("no debe llamar a Meta, llamó %d veces", c.calls.Load())
	}
}

func TestMetaReminder_GraphErrors_OnlyRecipientOnesArePermanent(t *testing.T) {
	cases := []struct {
		code      int
		status    int
		permanent bool
	}{
		{131026, http.StatusBadRequest, true},       // número sin WhatsApp
		{131030, http.StatusBadRequest, true},       // fuera de la lista de la cuenta
		{132001, http.StatusBadRequest, false},      // plantilla aún sin aprobar: se reintenta
		{130429, http.StatusTooManyRequests, false}, // límite de Meta
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(`{"error":{"code":` + itoa(tc.code) + `,"type":"OAuthException","fbtrace_id":"A1"}}`))
		}))
		err := sendReminder(reminderSender(t, srv), testRecipient)
		srv.Close()
		if err == nil || isPermanent(err) != tc.permanent {
			t.Errorf("código %d: err=%v permanente=%v, quiero permanente=%v", tc.code, err, isPermanent(err), tc.permanent)
		}
		if err != nil && strings.Contains(err.Error(), "573001234567") {
			t.Errorf("código %d: el error no debe incluir el teléfono: %v", tc.code, err)
		}
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
