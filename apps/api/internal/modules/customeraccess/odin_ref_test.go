package customeraccess

import (
	"strings"
	"testing"
	"time"
)

var refSecret = []byte("secreto-de-prueba-hu106-no-real")

const refAppointmentID = "0b7e3c52-9a4d-4f10-8c6e-1d2a3b4c5d6e"

func TestAppointmentRef_RoundTripsForTheSameShopWhileItLasts(t *testing.T) {
	now := time.Now()
	ref, err := sealAppointmentRef(refAppointmentID, "vibras", now.Add(AppointmentRefTTL), refSecret)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	id, ok := openAppointmentRef(ref, "vibras", now, refSecret)
	if !ok || id != refAppointmentID {
		t.Fatalf("expected %s, got %q ok=%v", refAppointmentID, id, ok)
	}
	if len(ref) > maxAppointmentRefLength {
		t.Fatalf("the reference must fit the contract's 128 characters, got %d", len(ref))
	}
}

func TestAppointmentRef_IsOpaque(t *testing.T) {
	ref, err := sealAppointmentRef(refAppointmentID, "vibras", time.Now().Add(time.Hour), refSecret)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ref, "0b7e3c52") || strings.Contains(ref, strings.ReplaceAll(refAppointmentID, "-", "")) {
		t.Fatal("the reference must not expose the internal appointment identifier")
	}
	other, _ := sealAppointmentRef(refAppointmentID, "vibras", time.Now().Add(time.Hour), refSecret)
	if ref == other {
		t.Fatal("two references to the same appointment must differ (random nonce)")
	}
}

func TestAppointmentRef_RejectsEveryWayItCanBeWrong(t *testing.T) {
	now := time.Now()
	ref, _ := sealAppointmentRef(refAppointmentID, "vibras", now.Add(time.Minute), refSecret)
	tampered := ref[:len(ref)-2] + "AA"
	if ref[len(ref)-2:] == "AA" {
		tampered = ref[:len(ref)-2] + "BB"
	}

	cases := map[string]struct {
		ref, slug string
		now       time.Time
		secret    []byte
	}{
		"otra barbería": {ref, "otra", now, refSecret},
		"vencida":       {ref, "vibras", now.Add(2 * time.Minute), refSecret},
		"otro secreto":  {ref, "vibras", now, []byte("otro-secreto-de-prueba")},
		"alterada":      {tampered, "vibras", now, refSecret},
		"vacía":         {"", "vibras", now, refSecret},
		"no es base64":  {"%%%", "vibras", now, refSecret},
		"muy larga":     {strings.Repeat("a", 300), "vibras", now, refSecret},
	}
	for name, c := range cases {
		if id, ok := openAppointmentRef(c.ref, c.slug, c.now, c.secret); ok {
			t.Errorf("%s: must be rejected, opened %q", name, id)
		}
	}
}

func TestAppointmentRef_RejectsAMalformedIdentifier(t *testing.T) {
	if _, err := sealAppointmentRef("no-es-un-uuid", "vibras", time.Now(), refSecret); err == nil {
		t.Fatal("a non-UUID identifier must not be sealed")
	}
}

func TestHashAccessRef_BoundsTheInput(t *testing.T) {
	if _, ok := hashAccessRef("   "); ok {
		t.Fatal("blank reference must be rejected")
	}
	if _, ok := hashAccessRef(strings.Repeat("x", 129)); ok {
		t.Fatal("over-long reference must be rejected before touching the database")
	}
	a, ok := hashAccessRef("abc")
	b, _ := hashAccessRef(" abc ")
	if !ok || a != b || len(a) != 64 {
		t.Fatalf("expected a stable 64-hex hash, got %q / %q", a, b)
	}
}
