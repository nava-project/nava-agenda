package appointmentnotice_test

import (
	"testing"
	"time"

	"system-barbershop/internal/modules/appointmentnotice"
)

func TestWhenText_ReadsLikeAPersonInTheShopTimezone(t *testing.T) {
	bogota, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	// 22:30 del 16 de noviembre en Bogotá.
	nowLocal := time.Date(2026, 11, 16, 22, 30, 0, 0, bogota)
	cases := []struct {
		start time.Time
		want  string
	}{
		{time.Date(2026, 11, 16, 23, 10, 0, 0, bogota), "hoy a las 11:10 p. m."},
		{time.Date(2026, 11, 17, 0, 5, 0, 0, bogota), "mañana a las 12:05 a. m."},
		{time.Date(2026, 11, 17, 12, 0, 0, 0, bogota), "mañana a las 12:00 p. m."},
		{time.Date(2026, 11, 20, 9, 30, 0, 0, bogota), "el 20 de noviembre a las 9:30 a. m."},
	}
	for _, c := range cases {
		// El instante llega en UTC desde la base: se redacta en la zona del negocio.
		if got := appointmentnotice.WhenText(c.start.UTC(), nowLocal.UTC(), bogota); got != c.want {
			t.Errorf("WhenText(%s) = %q, quiero %q", c.start, got, c.want)
		}
	}
}
