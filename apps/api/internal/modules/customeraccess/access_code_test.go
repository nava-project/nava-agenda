package customeraccess

import (
	"strings"
	"testing"
	"time"

	"nava-agenda/internal/platform/apperr"
)

func TestNormalizeContact(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		want    Contact
		invalid bool
	}{
		{"correo en mayúsculas y con espacios", "  Ana.Perez@Example.TEST ", Contact{ChannelEmail, "ana.perez@example.test"}, false},
		{"celular colombiano sin prefijo", "3001234567", Contact{ChannelWhatsApp, "+573001234567"}, false},
		{"celular con separadores", "300 123-4567", Contact{ChannelWhatsApp, "+573001234567"}, false},
		{"celular con 57 sin más", "573001234567", Contact{ChannelWhatsApp, "+573001234567"}, false},
		{"celular en E.164", "+573001234567", Contact{ChannelWhatsApp, "+573001234567"}, false},
		{"número de otro país", "+14155550123", Contact{ChannelWhatsApp, "+14155550123"}, false},
		{"vacío", "   ", Contact{}, true},
		{"correo sin dominio", "ana@", Contact{}, true},
		{"correo con espacio dentro", "ana @example.test", Contact{}, true},
		{"colombiano con dígitos de más", "+5730012345678", Contact{}, true},
		{"colombiano con dígitos de menos", "+57300123456", Contact{}, true},
		{"letras", "abcdef", Contact{}, true},
		{"demasiado largo", strings.Repeat("a", 250) + "@x.co", Contact{}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeContact(tc.raw)
			if tc.invalid {
				if e, ok := apperr.As(err); !ok || e.Kind != apperr.KindValidation {
					t.Fatalf("expected a validation error, got %v", err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %+v, %v; want %+v", got, err, tc.want)
			}
		})
	}
}

func TestValidAccessCode(t *testing.T) {
	for code, want := range map[string]bool{"123456": true, "000000": true, "12345": false, "1234567": false, "12345a": false, "": false, " 12345": false} {
		if got := ValidAccessCode(code); got != want {
			t.Errorf("ValidAccessCode(%q) = %v, want %v", code, got, want)
		}
	}
}

func TestCryptoCodeGenerator_ProducesSixDigits(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code, err := CryptoCodeGenerator{}.New()
		if err != nil || !ValidAccessCode(code) {
			t.Fatalf("invalid code %q (%v)", code, err)
		}
		seen[code] = true
	}
	if len(seen) < 150 {
		t.Fatalf("the codes look far from random: %d distinct in 200", len(seen))
	}
}

func TestHashes_AreDomainSeparatedAndKeyed(t *testing.T) {
	secret := []byte("secreto-de-prueba")
	c := Contact{ChannelEmail, "ana@example.test"}
	ch := contactHash(c, secret)
	for name, h := range map[string]string{
		"contacto": ch, "ip": ipHash("203.0.113.9", secret), "código": codeHash(ch, "123456", secret),
	} {
		if len(h) != 64 || strings.ToLower(h) != h {
			t.Fatalf("%s hash must be 64 lowercase hex characters, got %q", name, h)
		}
	}
	if ipHash(c.Value, secret) == ch {
		t.Fatal("an IP hash must not collide with a contact hash of the same text")
	}
	if contactHash(c, []byte("otro-secreto")) == ch {
		t.Fatal("the hash must depend on the deployment secret")
	}
	if codeHash(ch, "123456", secret) == codeHash(contactHash(Contact{ChannelEmail, "luis@example.test"}, secret), "123456", secret) {
		t.Fatal("the same code must hash differently for different contacts")
	}
}

func TestMintAccessToken_HashMatchesAndIsUnpredictable(t *testing.T) {
	plain, hash, err := mintAccessToken()
	if err != nil {
		t.Fatalf("mintAccessToken: %v", err)
	}
	again, _, _ := mintAccessToken()
	if plain == again || len(plain) != 43 || len(hash) != 64 {
		t.Fatalf("unexpected token shape: %q (%d) / hash %d", plain, len(plain), len(hash))
	}
	// Mismo cálculo que usa el lado de lectura (HU-098) para buscar el acceso.
	if got, ok := hashToken(plain); !ok || got != hash {
		t.Fatalf("the stored hash must be the one the reader computes: %q vs %q", got, hash)
	}
}

func TestRetryAfterSeconds_RoundsUpAndNeverReturnsZero(t *testing.T) {
	for in, want := range map[time.Duration]int{0: 1, -time.Second: 1, 200 * time.Millisecond: 1, time.Second: 1, 1100 * time.Millisecond: 2, 5 * time.Minute: 300} {
		if got := retryAfterSeconds(in); got != want {
			t.Errorf("retryAfterSeconds(%v) = %d, want %d", in, got, want)
		}
	}
}
