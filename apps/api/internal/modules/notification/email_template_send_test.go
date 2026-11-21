package notification_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"nava-agenda/internal/modules/notification"
)

// Los cuatro correos transaccionales salen con la plantilla de marca: la misma
// petición lleva HTML y texto plano (issue #465), y el nombre del cliente, que
// es entrada de usuario, llega escapado en el HTML.
func TestTransactionalEmails_SendBrandedHTMLAndText(t *testing.T) {
	const evil = `Ana <script>alert(1)</script>`

	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = nil
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	client := srv.Client()
	client.Transport = redirectTransport{target: srv.URL}

	cases := []struct {
		name  string
		send  func() error
		wants []string
	}{
		{"recuperación", func() error {
			return notification.NewResendEmailSender(
				notification.ResendEmailConfig{APIKey: "k", FromAddress: "a@b.test", Subject: "Recuperación"}, client,
			).Send(context.Background(), "c@ejemplo.test", "482913")
		}, []string{"482913", "Recupera tu acceso", "Verifica el código"}},
		{"acceso", func() error {
			return notification.NewResendLoginChallengeEmailSender(
				notification.ResendEmailConfig{APIKey: "k", FromAddress: "a@b.test"}, client,
			).SendCode(context.Background(), "c@ejemplo.test", "482913")
		}, []string{"482913", "Confirma que eres tú"}},
		{"confirmación", func() error {
			return notification.NewResendConfirmationEmailSender(
				notification.ResendConfirmationEmailConfig{APIKey: "k", FromAddress: "a@b.test"}, client,
			).SendConfirmation(context.Background(), "c@ejemplo.test", "Barbería Centro", "Corte", "Laura", evil,
				bogota(t, 2099, 1, 7, 16, 30), 45, "Calle 10 # 4-21", false, "https://nava.test/turno/x")
		}, []string{"Barbería Centro", "Corte", "Laura", "45 min", "Calle 10 # 4-21", "4:30\u00a0p.\u00a0m.", "miércoles 7 de enero", "Ver mi turno", "https://nava.test/turno/x"}},
		{"cancelación", func() error {
			return newChangeNoticeSender(t, srv).SendChangeNotice(context.Background(),
				"cancelled_by_professional", "c@ejemplo.test", "Barbería Centro", "Corte", "Laura", evil, bogota(t, 2099, 1, 7, 16, 30), "")
		}, []string{"Barbería Centro", "Cancelado", "miércoles 7 de enero", "Reserva de nuevo"}},
		{"recordatorio", func() error {
			return newChangeNoticeSender(t, srv).SendChangeNotice(context.Background(),
				"reminder", "c@ejemplo.test", "Barbería Centro", "Corte", "Laura", evil, bogota(t, 2099, 1, 7, 16, 30), "hoy a las 4:30 p. m.")
		}, []string{"Barbería Centro", "Recordatorio", "miércoles 7 de enero", "Tu turno es hoy a las 4:30\u00a0p.\u00a0m."}},
		{"reprogramación", func() error {
			return newChangeNoticeSender(t, srv).SendChangeNotice(context.Background(),
				"rescheduled", "c@ejemplo.test", "Barbería Centro", "Corte", "Laura", evil, bogota(t, 2099, 1, 8, 10, 0), "")
		}, []string{"Barbería Centro", "Nuevo horario", "jueves 8 de enero", "10:00\u00a0a.\u00a0m."}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.send(); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			html, _ := got["html"].(string)
			text, _ := got["text"].(string)
			if html == "" || text == "" {
				t.Fatalf("la petición debe llevar html y text: html=%d text=%d", len(html), len(text))
			}
			if !strings.Contains(html, "Nava Agenda") || !strings.Contains(text, "Nava Agenda") {
				t.Error("ambas versiones llevan la marca")
			}
			// El código va en celdas (#753): en el HTML se lee seguido al quitar
			// etiquetas y espacios.
			squashed := strings.Join(strings.Fields(tagPattern.ReplaceAllString(html, "")), "")
			for _, want := range tc.wants {
				inHTML := strings.Contains(strings.ToLower(html), strings.ToLower(want)) || strings.Contains(squashed, want)
				if !inHTML || !strings.Contains(strings.ToLower(text), strings.ToLower(want)) {
					t.Errorf("%q debe estar en html y en text", want)
				}
			}
			if strings.Contains(html, "<script>") {
				t.Errorf("el nombre del cliente debe escaparse en el HTML:\n%s", html)
			}
		})
	}
}

var tagPattern = regexp.MustCompile(`<[^>]*>`)
