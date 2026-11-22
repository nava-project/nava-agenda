package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nava-agenda/internal/modules/auth"
)

// Adaptadores de desarrollo y de prueba de los envíos de códigos (HU-007,
// HU-008, DEC-139): los que solo registran nunca escriben el destino ni el
// código en el log (RN-DAT-02), y los que capturan el código para los E2E lo
// escriben solo después de una entrega real exitosa (CP-NF07).

const (
	devPhone = "+573001112233"
	devEmail = "duena@alfa.example.test"
	devCode  = "482913"
)

func TestLoggingSenders_NeverLogTheDestinationOrTheCode(t *testing.T) {
	for name, send := range map[string]func(*slog.Logger) error{
		"reto telefónico": func(l *slog.Logger) error {
			return auth.NewLoggingPhoneCodeSender(l).SendCode(context.Background(), devPhone, devCode)
		},
		"recuperación": func(l *slog.Logger) error {
			return auth.NewLoggingRecoveryCodeSender(l).SendCode(context.Background(), devPhone, devEmail, devCode)
		},
	} {
		t.Run(name, func(t *testing.T) {
			var buf bytes.Buffer
			if err := send(slog.New(slog.NewTextHandler(&buf, nil))); err != nil {
				t.Fatalf("el envío simulado nunca falla: %v", err)
			}
			if buf.Len() == 0 {
				t.Fatal("debe quedar una línea que diga que el envío fue simulado")
			}
			for _, secret := range []string{devPhone, devEmail, devCode} {
				if strings.Contains(buf.String(), secret) {
					t.Fatalf("el log contiene %q: %s", secret, buf.String())
				}
			}
		})
	}
}

type recordingRecoverySender struct {
	err   error
	calls int
}

func (s *recordingRecoverySender) SendCode(context.Context, string, string, string) error {
	s.calls++
	return s.err
}

func TestCapturingRecoveryCodeSender_WritesOnlyAfterASuccessfulDelivery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recovery.json")
	inner := &recordingRecoverySender{}
	if err := auth.NewCapturingRecoveryCodeSender(inner, path).SendCode(context.Background(), devPhone, devEmail, devCode); err != nil {
		t.Fatalf("SendCode: %v", err)
	}
	var got struct{ Phone, Email, Code string }
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("leer captura: %v", err)
	}
	if err := json.Unmarshal(data, &got); err != nil || got.Phone != devPhone || got.Email != devEmail || got.Code != devCode || inner.calls != 1 {
		t.Fatalf("captura = %+v (%v), %d envíos", got, err, inner.calls)
	}

	failedPath := filepath.Join(t.TempDir(), "failed.json")
	wantErr := errors.New("proveedor caído")
	err = auth.NewCapturingRecoveryCodeSender(&recordingRecoverySender{err: wantErr}, failedPath).SendCode(context.Background(), devPhone, devEmail, devCode)
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
	if _, statErr := os.Stat(failedPath); !os.IsNotExist(statErr) {
		t.Fatal("sin entrega exitosa no debe escribirse ninguna captura")
	}

	unwritable := filepath.Join(t.TempDir(), "no-existe", "recovery.json")
	if err := auth.NewCapturingRecoveryCodeSender(&recordingRecoverySender{}, unwritable).SendCode(context.Background(), devPhone, devEmail, devCode); err == nil {
		t.Fatal("un destino de captura inexistente debe reportarse")
	}
}

type failingOTPProvider struct{ fakeOTPProvider }

func (p *failingOTPProvider) Deliver(context.Context, string, auth.PreparedWhatsAppOTP) error {
	return errors.New("WhatsApp no disponible")
}

func TestCapturingWhatsAppOTPProvider_DelegatesAndCapturesTheDeliveredCode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "otp.json")
	inner := &fakeOTPProvider{}
	provider := auth.NewCapturingWhatsAppOTPProvider(inner, path)

	prepared, err := provider.Prepare(context.Background())
	if err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := provider.Deliver(context.Background(), devPhone, prepared); err != nil {
		t.Fatalf("Deliver: %v", err)
	}
	if len(inner.delivered) != 1 || inner.delivered[0].phone != devPhone {
		t.Fatalf("la entrega real debía ocurrir una vez: %+v", inner.delivered)
	}
	var got struct{ Phone, Code string }
	data, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(data, &got) != nil || got.Code != prepared.Code() || got.Phone != devPhone {
		t.Fatalf("captura = %+v (%v)", got, err)
	}
	if provider.VerificationDigest(devCode) != "digest-of-"+devCode {
		t.Fatal("el digest de verificación debe delegarse al proveedor real")
	}

	failedPath := filepath.Join(t.TempDir(), "failed.json")
	if err := auth.NewCapturingWhatsAppOTPProvider(&failingOTPProvider{}, failedPath).Deliver(context.Background(), devPhone, prepared); err == nil {
		t.Fatal("el fallo de la entrega real debe propagarse")
	}
	if _, statErr := os.Stat(failedPath); !os.IsNotExist(statErr) {
		t.Fatal("sin entrega exitosa no debe escribirse ninguna captura")
	}
}

func TestRecoveryChannel_OnlyEmailAndWhatsAppAreValid(t *testing.T) {
	for channel, want := range map[auth.RecoveryChannel]bool{
		auth.RecoveryChannelEmail: true, auth.RecoveryChannelWhatsApp: true, "sms": false, "": false,
	} {
		if got := channel.Valid(); got != want {
			t.Errorf("RecoveryChannel(%q).Valid() = %v, want %v", channel, got, want)
		}
	}
}
