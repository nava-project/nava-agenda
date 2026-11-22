// Casos del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III) que se
// verifican en el algoritmo puro de disponibilidad: CP-008, CP-011 y CP-017.
// Fixture del plan: lunes 14 de septiembre de 2026 en la Barbería Alfa, jornada
// 09:00–18:00 con descanso 12:00–13:00 (dos tramos), cita 10:00–10:30 y bloqueo
// 15:00–16:00. La etapa «Pruebas unitarias · Plan de Pruebas (CP)» del
// Jenkinsfile corre todo lo que empieza por TestCP.
package availability_test

import (
	"testing"
	"time"

	"nava-agenda/internal/modules/availability"
)

// cpJornada es la jornada del plan: 09:00–18:00 con el descanso 12:00–13:00
// fuera de los tramos, como lo entrega el día efectivo del horario.
func cpJornada() []availability.Interval {
	return []availability.Interval{
		{Start: at(9, 0), End: at(12, 0)},
		{Start: at(13, 0), End: at(18, 0)},
	}
}

func cpCita() availability.Interval { return availability.Interval{Start: at(10, 0), End: at(10, 30)} }
func cpBloqueo() availability.Interval {
	return availability.Interval{Start: at(15, 0), End: at(16, 0)}
}

func cpPolicy(duration, grid time.Duration, earliest time.Time) availability.Policy {
	return availability.Policy{ServiceDuration: duration, GridStep: grid, EarliestStart: earliest, LatestStart: atDay(30, 0, 0)}
}

func cpContains(starts []time.Time, want time.Time) bool {
	for _, s := range starts {
		if s.Equal(want) {
			return true
		}
	}
	return false
}

func TestCP008_DescansosBloqueosYExcepciones(t *testing.T) {
	policy := cpPolicy(30*time.Minute, 30*time.Minute, at(0, 0))

	t.Run("CP-008 el descanso 12:00–13:00 y el bloqueo 15:00–16:00 no se ofrecen", func(t *testing.T) {
		got := availability.GenerateStarts(cpJornada(), []availability.Interval{cpBloqueo()}, policy)
		for _, excluded := range []time.Time{at(12, 0), at(12, 30), at(15, 0), at(15, 30)} {
			if cpContains(got, excluded) {
				t.Errorf("%s cae en el descanso o el bloqueo y se ofreció", excluded.Format("15:04"))
			}
		}
		for _, offered := range []time.Time{at(11, 30), at(13, 0), at(14, 30), at(16, 0)} {
			if !cpContains(got, offered) {
				t.Errorf("%s está libre junto al descanso o el bloqueo y no se ofreció", offered.Format("15:04"))
			}
		}
	})

	t.Run("CP-008 un bloqueo recurrente afecta cada fecha en la que se repite", func(t *testing.T) {
		// Bloqueo semanal de los lunes 15:00–16:00: el lunes 14 y el lunes 21.
		lunes21 := []availability.Interval{
			{Start: atDay(21, 9, 0), End: atDay(21, 12, 0)},
			{Start: atDay(21, 13, 0), End: atDay(21, 18, 0)},
		}
		segments := append(cpJornada(), lunes21...)
		busy := []availability.Interval{cpBloqueo(), {Start: atDay(21, 15, 0), End: atDay(21, 16, 0)}}
		got := availability.GenerateStarts(segments, busy, policy)
		if cpContains(got, at(15, 0)) || cpContains(got, atDay(21, 15, 0)) {
			t.Errorf("el bloqueo recurrente de las 15:00 se ofreció en alguna de sus fechas")
		}
		if !cpContains(got, atDay(21, 16, 0)) {
			t.Errorf("el lunes 21 a las 16:00 está libre y no se ofreció")
		}
	})

	t.Run("CP-008 festivo cerrado no ofrece horas y la apertura manual sí", func(t *testing.T) {
		if got := availability.GenerateStarts(nil, nil, policy); len(got) != 0 {
			t.Errorf("festivo cerrado (sin tramos) ofreció %v", got)
		}
		apertura := []availability.Interval{{Start: at(9, 0), End: at(13, 0)}}
		if got := availability.GenerateStarts(apertura, nil, policy); !cpContains(got, at(9, 0)) || !cpContains(got, at(12, 30)) {
			t.Errorf("la apertura manual 09:00–13:00 del festivo debía prevalecer, got %v", got)
		}
	})

	t.Run("CP-008 un bloqueo dentro del descanso no resta dos veces", func(t *testing.T) {
		busy := []availability.Interval{{Start: at(12, 15), End: at(12, 45)}}
		got := availability.GenerateStarts(cpJornada(), busy, policy)
		if !cpContains(got, at(11, 30)) || !cpContains(got, at(13, 0)) {
			t.Errorf("las horas que rodean al descanso debían seguir libres, got %v", got)
		}
	})
}

func TestCP011_SoloHorasRealmenteLibres(t *testing.T) {
	ahora := at(9, 40) // ya pasaron las 09:00 y las 09:30
	busy := []availability.Interval{cpCita(), cpBloqueo()}

	for _, tc := range []struct {
		servicio string
		duracion time.Duration
		want     []time.Time
	}{
		{
			servicio: "Corte (30 min)",
			duracion: 30 * time.Minute,
			want: wantTimes(at(10, 30), at(11, 0), at(11, 30), at(13, 0), at(13, 30), at(14, 0), at(14, 30),
				at(16, 0), at(16, 30), at(17, 0), at(17, 30)),
		},
		{
			// 11:30 invadiría el descanso, 14:30 el bloqueo y 17:30 el cierre.
			servicio: "Corte + barba (45 min)",
			duracion: 45 * time.Minute,
			want:     wantTimes(at(10, 30), at(11, 0), at(13, 0), at(13, 30), at(14, 0), at(16, 0), at(16, 30), at(17, 0)),
		},
	} {
		t.Run("CP-011 "+tc.servicio+": ni pasadas ni ocupadas, y cada intervalo cabe completo", func(t *testing.T) {
			got := availability.GenerateStarts(cpJornada(), busy, cpPolicy(tc.duracion, 30*time.Minute, ahora))
			assertEqualTimes(t, got, tc.want)
			for _, start := range got {
				end := start.Add(tc.duracion)
				if start.Before(ahora) {
					t.Errorf("%s ya pasó", start.Format("15:04"))
				}
				for _, b := range busy {
					if start.Before(b.End) && b.Start.Before(end) {
						t.Errorf("%s–%s se cruza con una ocupación", start.Format("15:04"), end.Format("15:04"))
					}
				}
				inside := false
				for _, seg := range cpJornada() {
					if !start.Before(seg.Start) && !end.After(seg.End) {
						inside = true
					}
				}
				if !inside {
					t.Errorf("%s–%s no cabe completo en un tramo de la jornada", start.Format("15:04"), end.Format("15:04"))
				}
			}
		})
	}
}

func TestCP017_DuracionCompletaYLimitesSemiabiertos(t *testing.T) {
	busy := []availability.Interval{cpCita()}

	t.Run("CP-017 un servicio de 45 min no se ofrece a las 11:30 ni a las 17:30", func(t *testing.T) {
		got := availability.GenerateStarts(cpJornada(), busy, cpPolicy(45*time.Minute, 15*time.Minute, at(0, 0)))
		if cpContains(got, at(11, 30)) {
			t.Errorf("11:30 + 45 min invade el descanso de las 12:00 y se ofreció")
		}
		if cpContains(got, at(17, 30)) {
			t.Errorf("17:30 + 45 min pasa del cierre de las 18:00 y se ofreció")
		}
		if !cpContains(got, at(11, 15)) || !cpContains(got, at(17, 15)) {
			t.Errorf("11:15 y 17:15 terminan justo en el descanso y en el cierre y debían ofrecerse, got %v", got)
		}
	})

	t.Run("CP-017 la cita contigua 10:30–11:00 cabe y la cruzada 10:15–10:45 no", func(t *testing.T) {
		got := availability.GenerateStarts(cpJornada(), busy, cpPolicy(30*time.Minute, 15*time.Minute, at(0, 0)))
		if !cpContains(got, at(10, 30)) {
			t.Errorf("10:30–11:00 es contigua a la cita 10:00–10:30 ([inicio, fin)) y no se ofreció")
		}
		if cpContains(got, at(10, 15)) {
			t.Errorf("10:15–10:45 se cruza con la cita 10:00–10:30 y se ofreció")
		}
		if !cpContains(got, at(9, 30)) {
			t.Errorf("09:30–10:00 termina justo donde empieza la cita y no se ofreció")
		}
	})
}
