// Casos del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III) de acceso:
// CP-001 (ingreso y sesión segura) y CP-038 (protección escalonada contra
// abuso). Fixture del plan: cuenta verificada de la Barbería Alfa, reloj
// controlable e IP de documentación (RFC 5737). La etapa «Pruebas unitarias ·
// Plan de Pruebas (CP)» del Jenkinsfile corre todo lo que empieza por TestCP.
// El conteo real de la ventana deslizante y la revocación bajo RLS se prueban
// con PostgreSQL en internal/modules/auth/postgres y database/tests/hu007_*.sql.
package auth_test

import (
	"context"
	"testing"
	"time"

	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/platform/apperr"
)

const (
	cpAlfaID     = "a1fa0000-0000-4000-8000-000000000001"
	cpAlfaUserID = "a1fa0000-0000-4000-8000-0000000000a1"
	cpAlfaEmail  = "duena@alfa.example.test"
)

func TestCP001_SesionValidaRenovableYRevocable(t *testing.T) {
	now := time.Date(2026, time.September, 14, 9, 0, 0, 0, time.UTC)

	t.Run("CP-001 credenciales válidas crean una sesión de 30 días", func(t *testing.T) {
		repo := &fakeRepository{
			resolveShop: cpAlfaID, resolveFound: true,
			lookupCred: auth.Credential{Found: true, StaffUserID: cpAlfaUserID, PasswordHash: "hash", PasswordAlgorithm: "argon2id"},
		}
		svc := newTestService(t, repo, &fakeHasher{verifyResult: true}, &fakeTokens{token: "token-cp001"}, fixedClock{now})
		session, err := svc.Login(context.Background(), cpAlfaEmail, "contraseña-de-prueba", testIP)
		if err != nil {
			t.Fatalf("Login: %v", err)
		}
		if session.BusinessID != cpAlfaID || !session.ExpiresAt.Equal(now.Add(30*24*time.Hour)) {
			t.Fatalf("sesión inesperada: negocio %q, vence %v", session.BusinessID, session.ExpiresAt)
		}
	})

	t.Run("CP-001 credenciales erróneas no autorizan ni crean sesión", func(t *testing.T) {
		repo := &fakeRepository{
			resolveShop: cpAlfaID, resolveFound: true,
			lookupCred: auth.Credential{Found: true, StaffUserID: cpAlfaUserID, PasswordHash: "hash"},
		}
		svc := newTestService(t, repo, &fakeHasher{verifyResult: false}, &fakeTokens{token: "token-cp001"}, fixedClock{now})
		_, err := svc.Login(context.Background(), cpAlfaEmail, "contraseña-equivocada", testIP)
		requireUnauthorized(t, err)
		if len(repo.createSessionCalls) != 0 {
			t.Fatal("se creó una sesión con credenciales erróneas")
		}
	})

	t.Run("CP-001 usar la sesión la renueva otros 30 días", func(t *testing.T) {
		usada := now.Add(10 * 24 * time.Hour)
		repo := &fakeSessionRepository{
			resolveShop: cpAlfaID, resolveFound: true,
			renewPrincipal: auth.Principal{SessionID: "s-cp001", StaffUserID: cpAlfaUserID, BusinessID: cpAlfaID}, renewValid: true,
		}
		if _, err := auth.NewSessionService(repo, fixedClock{now: usada}).Validate(context.Background(), "token-cp001"); err != nil {
			t.Fatalf("Validate: %v", err)
		}
		if len(repo.renewCalls) != 1 || !repo.renewCalls[0].newExpiresAt.Equal(usada.Add(30*24*time.Hour)) {
			t.Fatalf("renovación inesperada: %+v", repo.renewCalls)
		}
	})

	t.Run("CP-001 una sesión cerrada o vencida no autoriza", func(t *testing.T) {
		repo := &fakeSessionRepository{resolveShop: cpAlfaID, resolveFound: true, renewValid: false}
		_, err := auth.NewSessionService(repo, fixedClock{now: now.Add(31 * 24 * time.Hour)}).Validate(context.Background(), "token-cp001")
		assertUnauthorized(t, err)
	})

	t.Run("CP-001 cerrar sesión la revoca en el servidor", func(t *testing.T) {
		repo := &fakeSessionRepository{}
		principal := auth.Principal{SessionID: "s-cp001", StaffUserID: cpAlfaUserID, BusinessID: cpAlfaID}
		if err := auth.NewSessionService(repo, fixedClock{now: now}).Logout(context.Background(), principal); err != nil {
			t.Fatalf("Logout: %v", err)
		}
		if len(repo.revokeCalls) != 1 || repo.revokeCalls[0].sessionID != "s-cp001" || repo.revokeCalls[0].shop != cpAlfaID {
			t.Fatalf("revocación inesperada: %+v", repo.revokeCalls)
		}
	})
}

func TestCP038_SextaSolicitudExigeRetoDurante24h(t *testing.T) {
	now := time.Date(2026, time.September, 14, 9, 0, 0, 0, time.UTC)
	// Política del RFP: 5 solicitudes en 15 min; desde la sexta, reto durante 24 h.
	cfg := auth.ThrottleConfig{WindowSeconds: 15 * 60, EscalationSeconds: 24 * 60 * 60, Threshold: 5, RetentionSeconds: 48 * 60 * 60}
	secreto := []byte("secreto-de-prueba-suficientemente-largo")

	t.Run("CP-038 la quinta solicitud en 15 min pasa sin reto", func(t *testing.T) {
		repo := &fakeThrottleRepository{attemptCount: 5, escalated: false}
		if err := auth.NewThrottleService(repo, cfg, secreto, fixedClock{now}).Check(context.Background(), "198.51.100.7"); err != nil {
			t.Fatalf("quinta solicitud: %v", err)
		}
		if got := repo.calls[0].cfg; got.Threshold != 5 || got.WindowSeconds != 900 || got.EscalationSeconds != 86400 {
			t.Fatalf("el servidor no aplicó la política del plan: %+v", got)
		}
	})

	t.Run("CP-038 la sexta exige el reto telefónico durante 24 h", func(t *testing.T) {
		repo := &fakeThrottleRepository{attemptCount: 6, escalated: true, retryAfter: now.Add(24 * time.Hour)}
		err := auth.NewThrottleService(repo, cfg, secreto, fixedClock{now}).Check(context.Background(), "198.51.100.7")
		appErr, ok := apperr.As(err)
		if !ok || appErr.Kind != apperr.KindChallengeRequired {
			t.Fatalf("esperaba reto obligatorio, got %v", err)
		}
		if appErr.RetryAfterSeconds != 24*60*60 {
			t.Fatalf("Retry-After = %d s, want 86400 (24 h)", appErr.RetryAfterSeconds)
		}
	})

	t.Run("CP-038 pasadas las 24 h no queda bloqueo permanente", func(t *testing.T) {
		repo := &fakeThrottleRepository{attemptCount: 1, escalated: false}
		if err := auth.NewThrottleService(repo, cfg, secreto, fixedClock{now.Add(24*time.Hour + time.Minute)}).Check(context.Background(), "198.51.100.7"); err != nil {
			t.Fatalf("tras el escalamiento la IP debía volver a entrar: %v", err)
		}
	})
}
