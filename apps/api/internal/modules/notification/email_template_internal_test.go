package notification

import (
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func channel(c float64) float64 {
	c /= 255
	if c <= 0.03928 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

func luminance(t *testing.T, hex string) float64 {
	t.Helper()
	n, err := strconv.ParseUint(strings.TrimPrefix(hex, "#"), 16, 32)
	if err != nil {
		t.Fatalf("color inválido %q", hex)
	}
	r, g, b := float64(n>>16&0xff), float64(n>>8&0xff), float64(n&0xff)
	return 0.2126*channel(r) + 0.7152*channel(g) + 0.0722*channel(b)
}

func contrast(t *testing.T, fg, bg string) float64 {
	a, b := luminance(t, fg), luminance(t, bg)
	if a < b {
		a, b = b, a
	}
	return (a + 0.05) / (b + 0.05)
}

// Cada par de texto y fondo que la plantilla pinta debe cumplir AA (4.5:1),
// tanto en claro como en el modo oscuro de la hoja <style>.
func TestEmailTemplate_ColorPairsMeetAA(t *testing.T) {
	pairs := []struct{ name, fg, bg string }{
		{"texto sobre papel", emailTextMain, emailPaper},
		{"texto secundario sobre papel", emailTextMuted, emailPaper},
		{"pie sobre crema", emailTextMuted, emailCream},
		{"rótulo de latón sobre papel", emailBrassText, emailPaper},
		{"rótulo de latón sobre crema", emailBrassText, emailCream},
		{"título sobre papel", emailInk, emailPaper},
		{"marca sobre papel", emailInk, emailPaper},
		{"dígito del código sobre papel", emailInk, emailPaper},
		{"etiqueta de dato sobre crema", emailBrassText, emailCream},
		{"valor de dato sobre crema", emailInk, emailCream},
		{"botón", emailCream, emailInk},
		// Modo oscuro (hoja <style>).
		{"oscuro: texto sobre tarjeta", "#eef1f8", "#151b35"},
		{"oscuro: secundario sobre tarjeta", "#a9b1c6", "#151b35"},
		{"oscuro: secundario sobre fondo", "#a9b1c6", "#0b1022"},
		{"oscuro: latón sobre tarjeta", "#c9a86f", "#151b35"},
		{"oscuro: latón sobre fondo", "#c9a86f", "#0b1022"},
		{"oscuro: dígito sobre celda", "#eef1f8", "#0b1022"},
		{"oscuro: texto sobre dato", "#eef1f8", "#0b1022"},
		{"oscuro: botón", "#0b1022", "#c9a86f"},
		{"oscuro: insignia neutra", "#b9cde3", "#1c2a44"},
		{"oscuro: insignia de éxito", "#6fd39a", "#12301f"},
		{"oscuro: insignia de aviso", "#f2c060", "#33280f"},
		{"oscuro: insignia de peligro", "#ff8f87", "#3a1518"},
	}
	for _, tone := range []emailTone{toneNeutral, toneSuccess, toneWarning, toneDanger} {
		bg, fg, _ := badgeColors(tone)
		pairs = append(pairs, struct{ name, fg, bg string }{"insignia " + string(fg), string(fg), string(bg)})
	}
	for _, p := range pairs {
		if got := contrast(t, p.fg, p.bg); got < 4.5 {
			t.Errorf("%s: contraste %.2f < 4.5 (%s sobre %s)", p.name, got, p.fg, p.bg)
		}
	}
}

func TestEmailTemplate_EscapesEveryDynamicValue(t *testing.T) {
	evil := `<img src=x onerror=alert(1)>"&'`
	html, err := emailContent{
		Preheader:  evil,
		Brand:      evil,
		Badge:      &emailBadge{Label: evil, Tone: toneDanger},
		Title:      evil,
		Greeting:   evil,
		Paragraphs: []string{evil},
		Details:    []emailDetail{{Label: evil, Value: evil}},
		Code:       evil,
		Button:     &emailButton{Label: evil, URL: "https://nava.test/t?a=1&b=" + evil},
		Footnotes:  []string{evil},
	}.HTML()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html, "<img") || strings.Contains(html, "onerror=alert(1)>") {
		t.Fatalf("un valor dinámico llegó sin escapar:\n%s", html)
	}
	if !strings.Contains(html, "&lt;img") {
		t.Fatal("el valor escapado debe aparecer en el HTML")
	}
}

func TestEmailTemplate_ButtonRules(t *testing.T) {
	base := emailContent{Title: "T"}

	none, _ := base.HTML()
	if strings.Contains(none, "<a href") {
		t.Fatal("sin botón no debe haber enlace")
	}

	empty := base
	empty.Button = &emailButton{Label: "Ver", URL: ""}
	got, _ := empty.HTML()
	if strings.Contains(got, "<a href") || strings.Contains(empty.Text(), "Ver:") {
		t.Fatal("un botón sin URL no se dibuja ni aparece en el texto")
	}

	bad := base
	bad.Button = &emailButton{Label: "Ver", URL: "javascript:alert(1)"}
	got, _ = bad.HTML()
	if strings.Contains(got, "javascript:alert") {
		t.Fatalf("html/template debe neutralizar una URL javascript:\n%s", got)
	}

	ok := base
	ok.Button = &emailButton{Label: "Ver mi turno", URL: "https://nava.test/turno/abc"}
	got, _ = ok.HTML()
	if !strings.Contains(got, `href="https://nava.test/turno/abc"`) || !strings.Contains(ok.Text(), "Ver mi turno: https://nava.test/turno/abc") {
		t.Fatal("el botón válido debe estar en HTML y en texto")
	}
}

func TestEmailTemplate_StructureForMailClients(t *testing.T) {
	html, err := emailContent{Title: "Hola", Preheader: "Vista previa"}.HTML()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<html lang="es"`, `name="viewport"`, `color-scheme`, `prefers-color-scheme: dark`,
		`role="presentation"`, `max-width:600px`, "Vista previa", "Nava Agenda",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("la plantilla debe contener %q", want)
		}
	}
	if strings.Contains(html, "<script") || strings.Contains(html, "<img") || strings.Contains(html, "http://") {
		t.Error("el correo no debe llevar scripts, imágenes remotas ni recursos http")
	}
}

func TestEmailContent_TextKeepsOrderAndData(t *testing.T) {
	txt := emailContent{
		Brand: "Barbería Centro", Badge: &emailBadge{Label: "Turno cancelado"}, Title: "Tu turno fue cancelado",
		Greeting: "Hola Ana,", Paragraphs: []string{"Párrafo."},
		Details: []emailDetail{{"Servicio", "Corte"}, {"Fecha y hora", "mañana"}},
		Code:    "123456", Footnotes: []string{"Ignóralo."},
	}.Text()
	last := -1
	for _, want := range []string{"◆ NAVA Agenda", "Barbería Centro", "◆ Turno cancelado", "Tu turno fue cancelado", "Hola Ana,", "Párrafo.", "123456", "Servicio: Corte", "Fecha y hora: mañana", "Ignóralo.", "Nava Agenda"} {
		i := strings.Index(txt, want)
		if i < 0 || i < last {
			t.Fatalf("%q falta o está fuera de orden en:\n%s", want, txt)
		}
		last = i
	}
}

// #753: el código de cifras va en celdas, una por dígito, en la serif.
func TestEmailTemplate_CodeGoesInOneCellPerDigit(t *testing.T) {
	html, err := emailContent{Title: "Escribe tu código", Code: "482913"}.HTML()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(html, `class="cell"`); got != 6 {
		t.Fatalf("esperaba 6 celdas, hay %d", got)
	}
	for _, d := range []string{">4<", ">8<", ">2<", ">9<", ">1<", ">3<"} {
		if !strings.Contains(html, d) {
			t.Errorf("falta la celda %s", d)
		}
	}
	if !strings.Contains(html, `width="16.67%"`) {
		t.Error("las seis celdas se reparten la fila")
	}
	if strings.Contains(html, "monospace") || strings.Contains(html, "Courier") {
		t.Error("el código ya no va en una tipografía de máquina")
	}
}

func TestEmailTemplate_NonDigitCodeStaysInOneBlock(t *testing.T) {
	html, _ := emailContent{Title: "T", Code: "AB-12"}.HTML()
	if strings.Contains(html, `class="cell"`) || !strings.Contains(html, `class="codeblock"`) || !strings.Contains(html, "AB-12") {
		t.Fatal("un código que no es solo de cifras va entero en un bloque")
	}
}

// #753: la marca es texto (rombo en latón, NAVA y Agenda en serif), el rótulo
// junta negocio y motivo, y nada va en mayúsculas espaciadas.
func TestEmailTemplate_FamilyBrandWithoutImagesOrShouting(t *testing.T) {
	c := emailContent{Brand: "Barbería Centro", Kicker: "Tu turno", Title: "Escribe tu código", Code: "482913"}
	html, err := c.HTML()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"&#9670;", ">NAVA<", ">Agenda<", "Barbería Centro · Tu turno", "Instrument Serif", "Nava Agenda · agenda de citas para negocios"} {
		if !strings.Contains(html, want) {
			t.Errorf("la plantilla debe contener %q", want)
		}
	}
	if strings.Contains(html, "text-transform:uppercase") || strings.Contains(html, "<img") {
		t.Error("sin mayúsculas forzadas ni imágenes")
	}
	if !strings.HasPrefix(c.Text(), "◆ NAVA Agenda\n\nBarbería Centro · Tu turno\nEscribe tu código") {
		t.Errorf("el texto plano abre con la marca, el rótulo y el título:\n%s", c.Text())
	}
}

// TestEmailTemplate_WritePreviews escribe los correos de ejemplo para revisarlos
// en un navegador (issue #465). Se activa con EMAIL_PREVIEW_DIR=<carpeta>; sin
// ella se omite. Los datos son ficticios.
func TestEmailTemplate_WritePreviews(t *testing.T) {
	dir := os.Getenv("EMAIL_PREVIEW_DIR")
	if dir == "" {
		t.Skip("EMAIL_PREVIEW_DIR no definido")
	}
	samples := map[string]emailContent{
		"codigo-mi-turno": customerAccessEmail("Barbería Centro", "482913"),
		"codigo-acceso": {
			Preheader: "Tu código de verificación para entrar a Nava Agenda.", Kicker: "Entrar a tu agenda", Title: "Confirma que eres tú",
			Paragraphs: []string{"Escribe este código en la pantalla para entrar. Vence en pocos minutos."},
			Code:       "482913", Footnotes: []string{"Si no intentaste entrar, ignora este mensaje y considera cambiar tu contraseña."},
		},
		"codigo-recuperacion": {
			Preheader: "Tu código para recuperar el acceso a Nava Agenda.", Kicker: "Recupera tu acceso", Title: "Verifica el código",
			Paragraphs: []string{"Escríbelo en la pantalla para recuperar el acceso a tu cuenta. Vence en pocos minutos."},
			Code:       "482913", Footnotes: []string{"Si no lo solicitaste, ignora este mensaje: tu cuenta sigue segura."},
		},
		"confirmado": {
			Preheader: "Tu turno en Barbería Centro quedó confirmado.", Brand: "Barbería Centro",
			Badge: &emailBadge{Label: "Turno confirmado", Tone: toneSuccess}, Title: "Tu turno está listo",
			Greeting:   "Hola Ana,",
			Paragraphs: []string{"Tu turno en Barbería Centro quedó confirmado.", "Consulta tu turno cuando quieras con el siguiente botón."},
			Details:    []emailDetail{{"Servicio", "Corte clásico"}, {"Fecha y hora", "jueves 7 de enero, 4:30 p. m."}},
			Button:     &emailButton{Label: "Ver mi turno", URL: "https://nava.test/turno/ejemplo"},
			Footnotes:  []string{"Si no reservaste este turno, ignora este mensaje."},
		},
		"cancelado": {
			Preheader: "Barbería Centro canceló tu turno.", Brand: "Barbería Centro",
			Badge: &emailBadge{Label: "Turno cancelado", Tone: toneDanger}, Title: "Tu turno fue cancelado",
			Greeting:   "Hola Ana,",
			Paragraphs: []string{"Barbería Centro canceló tu turno. Estos son los datos del turno cancelado:", "Si quieres otro horario, comunícate con el negocio o reserva de nuevo."},
			Details:    []emailDetail{{"Servicio", "Corte clásico"}, {"Fecha y hora", "jueves 7 de enero, 4:30 p. m."}},
			Footnotes:  []string{"Si no esperabas este mensaje, ignóralo."},
		},
		"recordatorio": {
			Preheader: "Tu turno en Barbería Centro es muy pronto.", Brand: "Barbería Centro",
			Badge: &emailBadge{Label: "Recordatorio", Tone: toneNeutral}, Title: "Tu turno es muy pronto",
			Greeting:   "Hola Ana,",
			Paragraphs: []string{"Te recordamos tu turno en Barbería Centro. Te esperamos:", "Si no puedes asistir, avísale al negocio con tiempo."},
			Details:    []emailDetail{{"Servicio", "Corte clásico"}, {"Fecha y hora", "jueves 7 de enero, 4:30 p. m."}},
			Footnotes:  []string{"Si no esperabas este mensaje, ignóralo."},
		},
		"reprogramado": {
			Preheader: "Barbería Centro cambió el horario de tu turno.", Brand: "Barbería Centro",
			Badge: &emailBadge{Label: "Horario actualizado", Tone: toneWarning}, Title: "Tu turno cambió de horario",
			Greeting:   "Hola Ana,",
			Paragraphs: []string{"Barbería Centro cambió el horario de tu turno. Este es el horario vigente:", "Si no puedes asistir, comunícate con el negocio."},
			Details:    []emailDetail{{"Servicio", "Corte clásico"}, {"Fecha y hora", "viernes 8 de enero, 10:00 a. m."}},
			Footnotes:  []string{"Si no esperabas este mensaje, ignóralo."},
		},
	}
	for name, c := range samples {
		html, err := c.HTML()
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name+".html"), []byte(html), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name+".txt"), []byte(c.Text()), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}
