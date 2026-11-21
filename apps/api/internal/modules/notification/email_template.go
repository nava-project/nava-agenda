package notification

import (
	"bytes"
	"fmt"
	"html/template"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Plantilla compartida de los correos transaccionales (issue #465; marca de la
// familia en #753).
//
// Los correos que envía el backend (códigos de mi turno, de recuperación y de
// reto de acceso, confirmación de turno y avisos de HU-130) comparten la misma
// estructura: la marca «◆ NAVA Agenda», la regla de latón con su rombo, el
// rótulo (negocio y motivo), el título en serif, los párrafos, el código en
// seis celdas de latón, la tarjeta de datos, el botón y el pie. Cada remitente
// solo decide el contenido; la presentación vive aquí.
//
// Decisiones de diseño:
//   - Familia NAVA (DEC-077, DEC-189): papel #fffdf8 sobre crema #f4f0e7, tinta
//     #101b2b, latón #b8955a y el rombo como marca. Son los valores de
//     apps/web/src/styles/tokens.css repetidos como literales: un correo no lee
//     variables CSS. El rombo es el carácter ◆ en latón, nunca una imagen.
//   - Compatibilidad con clientes de correo: tablas de maquetación con
//     role="presentation", estilos en línea, ancho máximo 600 px que se contrae
//     hasta 320 px sin depender de media queries, tipografías del sistema
//     (Instrument Serif si está instalada; si no, Georgia) y ninguna imagen ni
//     recurso remoto.
//   - El código va en seis celdas, cada dígito en serif: se lee de un vistazo,
//     igual que las casillas de la pantalla donde se escribe. Copiado, deja los
//     seis dígitos (la pantalla descarta lo que no es cifra al pegar).
//   - Modo oscuro: `color-scheme` más una hoja <style> con prefers-color-scheme,
//     con los colores de la noche de la app. Los clientes que la ignoran
//     muestran la versión clara, que por sí sola cumple AA.
//   - Texto alternativo en la misma petición (Text), con el mismo contenido.
//   - Todo dato dinámico pasa por html/template, que escapa por contexto (texto
//     y atributos) y filtra las URL peligrosas; nombres de clientes y negocios
//     son entrada de usuarios.

// emailDetail es una fila de la tarjeta del turno.
type emailDetail struct {
	Label string
	Value string
}

// emailButton es la llamada a la acción. URL debe ser http(s); si llega vacía
// el botón no se dibuja y el remitente decide qué texto lo sustituye.
type emailButton struct {
	Label string
	URL   string
}

// emailContent es todo lo que un remitente aporta a la plantilla.
type emailContent struct {
	// Preheader es el texto de vista previa de la bandeja; no se muestra en el
	// cuerpo.
	Preheader string
	// Brand es el nombre del negocio, cuando el correo pertenece a uno (código
	// de mi turno, confirmación y avisos). Vacío en los correos de cuenta.
	Brand string
	// Kicker es el motivo del correo sobre el título («Tu turno»), en latón y
	// junto al negocio.
	Kicker     string
	Title      string
	Greeting   string
	Paragraphs []string
	// Code es un código de un solo uso. Si son de 4 a 8 cifras va en celdas,
	// una por dígito; si no, en un solo bloque.
	Code string
	// Ticket es el turno como tarjeta: la hora protagonista, la fecha y los
	// datos unidos por puntos guía, en los correos de la cita.
	Ticket *emailTicket
	// Closing son los párrafos que siguen a la tarjeta o a los datos: qué hacer
	// ahora, justo antes del botón.
	Closing   []string
	Button    *emailButton
	Footnotes []string
}

// emailTicket es la tarjeta del turno. Seal es su estado («Confirmado»,
// «Nuevo horario»); Struck tacha la hora y la fecha de un turno cancelado, y el
// texto plano lo dice con palabras.
type emailTicket struct {
	Seal   string
	Danger bool
	Clock  string
	Zone   string
	Day    string
	Struck bool
	Rows   []emailDetail
}

// ticketRow es una fila de la tarjeta. Inline une etiqueta y valor con puntos
// guía en una línea; un valor largo va debajo de su etiqueta para no desbordar
// el correo a 320 px.
type ticketRow struct {
	Label, Value string
	Inline       bool
}

// ticketInlineMax es el valor más largo, en caracteres, que cabe junto a su
// etiqueta y los puntos guía en el ancho útil de la tarjeta a 320 px.
const ticketInlineMax = 16

func ticketRows(rows []emailDetail) []ticketRow {
	out := make([]ticketRow, 0, len(rows))
	for _, r := range rows {
		if r.Value == "" {
			continue
		}
		out = append(out, ticketRow{Label: r.Label, Value: r.Value, Inline: utf8.RuneCountInString(r.Value) <= ticketInlineMax})
	}
	return out
}

// emailPalette son los literales de marca (modo claro). Los del modo oscuro
// viven en la hoja <style> de emailHTML.
const (
	emailInk        = "#101b2b"
	emailCream      = "#f4f0e7"
	emailPaper      = "#fffdf8"
	emailBrass      = "#b8955a"
	emailBrassText  = "#765c2f"
	emailTextMain   = "#2a2d32"
	emailTextMuted  = "#5e625f"
	emailBorder     = "#c9c0b2"
	emailDangerText = "#8a2c2c"
)

// codeCells parte el código en dígitos cuando es solo de cifras (4 a 8); con
// cualquier otra forma devuelve nil y el código va en un solo bloque.
var codeDigitsPattern = regexp.MustCompile(`^[0-9]{4,8}$`)

func codeCells(code string) []string {
	if !codeDigitsPattern.MatchString(code) {
		return nil
	}
	return strings.Split(code, "")
}

type emailView struct {
	emailContent
	Ink, Cream, Paper, Brass    template.CSS
	BrassText                   template.CSS
	TextMain, TextMuted, Border template.CSS
	HasGreeting                 bool
	CodeCells                   []string
	// CellWidth es el ancho de cada celda en porcentaje, para que la fila se
	// reparta entera sea cual sea el número de cifras.
	CellWidth string
	// TicketRows son las filas de la tarjeta ya decididas (en línea o debajo).
	TicketRows []ticketRow
	SealColor  template.CSS
	SealClass  string
}

// emailTemplate se compila una vez al cargar el paquete: una plantilla rota es
// un defecto de programación y debe fallar en las pruebas, no en producción.
var emailTemplate = template.Must(template.New("email").Parse(emailHTML))

// HTML renderiza la versión HTML. Con la plantilla ya compilada solo puede
// fallar si un dato no se puede escribir en el buffer, lo que no ocurre con un
// bytes.Buffer; aun así el error se propaga en vez de ocultarse.
func (c emailContent) HTML() (string, error) {
	v := emailView{
		emailContent: c,
		Ink:          emailInk, Cream: emailCream, Paper: emailPaper, Brass: emailBrass,
		BrassText: emailBrassText, TextMain: emailTextMain, TextMuted: emailTextMuted,
		Border:      emailBorder,
		HasGreeting: c.Greeting != "",
		CodeCells:   codeCells(c.Code),
	}
	if c.Ticket != nil {
		v.TicketRows = ticketRows(c.Ticket.Rows)
		v.SealColor, v.SealClass = emailBrassText, "brass"
		if c.Ticket.Danger {
			v.SealColor, v.SealClass = emailDangerText, "danger"
		}
	}
	if n := len(v.CodeCells); n > 0 {
		v.CellWidth = fmt.Sprintf("%.2f%%", 100/float64(n))
	}
	var buf bytes.Buffer
	if err := emailTemplate.Execute(&buf, v); err != nil {
		return "", fmt.Errorf("notification: renderizar plantilla de correo: %w", err)
	}
	return buf.String(), nil
}

// Text renderiza la versión de texto plano con el mismo contenido y orden.
func (c emailContent) Text() string {
	var b strings.Builder
	b.WriteString("◆ NAVA Agenda\n\n")
	switch {
	case c.Brand != "" && c.Kicker != "":
		b.WriteString(c.Brand + " · " + c.Kicker + "\n")
	case c.Brand != "":
		b.WriteString(c.Brand + "\n")
	case c.Kicker != "":
		b.WriteString(c.Kicker + "\n")
	}
	if c.Title != "" {
		b.WriteString(c.Title)
		b.WriteString("\n\n")
	}
	if c.Greeting != "" {
		b.WriteString(c.Greeting)
		b.WriteString("\n\n")
	}
	for _, p := range c.Paragraphs {
		b.WriteString(p)
		b.WriteString("\n\n")
	}
	if c.Code != "" {
		b.WriteString(c.Code)
		b.WriteString("\n\n")
	}
	if t := c.Ticket; t != nil {
		writeTicketText(&b, t)
	}
	for _, p := range c.Closing {
		b.WriteString(p)
		b.WriteString("\n\n")
	}
	if c.Button != nil && c.Button.URL != "" {
		fmt.Fprintf(&b, "%s: %s\n\n", c.Button.Label, c.Button.URL)
	}
	for _, f := range c.Footnotes {
		b.WriteString(f)
		b.WriteString("\n\n")
	}
	b.WriteString("Nava Agenda · agenda de citas para negocios")
	return b.String()
}

// writeTicketText escribe la tarjeta en texto plano. Sin tachado posible, el
// turno cancelado lo dice con palabras («Era el…»).
func writeTicketText(b *strings.Builder, t *emailTicket) {
	if t.Seal != "" {
		b.WriteString("◆ " + t.Seal + "\n")
	}
	when := t.Day + " · " + t.Clock
	if t.Zone != "" {
		when += " (" + t.Zone + ")"
	}
	if t.Struck {
		when = "Era el " + when
	}
	b.WriteString(when + "\n")
	for _, r := range ticketRows(t.Rows) {
		fmt.Fprintf(b, "%s: %s\n", r.Label, r.Value)
	}
	b.WriteString("\n")
}

// emailHTML usa el sistema de tablas anidadas habitual en correo. Las clases
// solo existen para la hoja <style> (modo oscuro y móvil estrecho); la versión
// base funciona con los estilos en línea.
const emailHTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{{.Title}}</title>
<style>
  body { margin:0; padding:0; }
  a { color: inherit; }
  @media (max-width: 480px) {
    .px { padding-left:20px !important; padding-right:20px !important; }
    .title { font-size:28px !important; }
    .cell { height:52px !important; line-height:52px !important; font-size:28px !important; }
    .cellgap { padding-left:2px !important; padding-right:2px !important; }
    .clock { font-size:36px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg { background:#0b1022 !important; }
    .card { background:#151b35 !important; border-color:#2a3256 !important; }
    .ink { color:#eef1f8 !important; }
    .muted { color:#a9b1c6 !important; }
    .brass { color:#c9a86f !important; }
    .rule { background:#b8955a !important; }
    .cell { background:#0b1022 !important; color:#eef1f8 !important; border-color:#c9a86f !important; }
    .codeblock { background:#0b1022 !important; color:#eef1f8 !important; border-color:#c9a86f !important; }
    .ticket { background:#0b1022 !important; border-color:#c9a86f !important; }
    .perf, .leader { border-color:#c9a86f !important; }
    .danger { color:#ff8f87 !important; }
    .btn { background:#c9a86f !important; }
    .btn a { color:#0b1022 !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:{{.Cream}};">
{{- if .Preheader}}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">{{.Preheader}}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
{{- end}}
<main>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{{.Cream}};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
    <tr><td class="card px" style="background:{{.Paper}};padding:28px 36px 30px 36px;border:1px solid {{.Border}};border-radius:6px;font-family:'Instrument Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="font-size:0;line-height:0;">
        <span class="brass" aria-hidden="true" style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:20px;color:{{.Brass}};vertical-align:middle;">&#9670;</span><span class="ink" style="padding-left:8px;font-family:'Instrument Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;font-weight:700;letter-spacing:3px;color:{{.Ink}};vertical-align:middle;">NAVA</span><span class="ink" style="padding-left:6px;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:19px;line-height:20px;color:{{.Ink}};vertical-align:middle;">Agenda</span>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 22px 0;">
        <tr>
          <td width="50%" style="vertical-align:middle;"><div class="rule" style="height:1px;line-height:1px;font-size:1px;background:{{.Brass}};">&nbsp;</div></td>
          <td class="brass" aria-hidden="true" style="padding:0 10px;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:13px;color:{{.Brass}};">&#9670;</td>
          <td width="50%" style="vertical-align:middle;"><div class="rule" style="height:1px;line-height:1px;font-size:1px;background:{{.Brass}};">&nbsp;</div></td>
        </tr>
      </table>
      {{- if or .Brand .Kicker}}
      <p class="brass" style="margin:0 0 6px 0;font-size:14px;line-height:1.4;font-weight:600;color:{{.BrassText}};">{{.Brand}}{{if and .Brand .Kicker}} · {{end}}{{.Kicker}}</p>
      {{- end}}
      <h1 class="title ink" style="margin:0 0 16px 0;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:34px;line-height:1.15;font-weight:400;color:{{.Ink}};">{{.Title}}</h1>
      {{- if .HasGreeting}}
      <p class="ink" style="margin:0 0 14px 0;font-size:16px;line-height:1.6;color:{{.TextMain}};">{{.Greeting}}</p>
      {{- end}}
      {{- range .Paragraphs}}
      <p class="ink" style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:{{$.TextMain}};">{{.}}</p>
      {{- end}}
      {{- if .CodeCells}}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:372px;margin:10px 0 24px 0;">
        <tr>
          {{- range .CodeCells}}
          <td class="cellgap" width="{{$.CellWidth}}" style="padding:0 3px;"><div class="cell" style="height:62px;line-height:62px;text-align:center;background:{{$.Paper}};border:1px solid {{$.Brass}};border-bottom:3px solid {{$.Brass}};border-radius:4px;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:36px;color:{{$.Ink}};">{{.}}</div></td>
          {{- end}}
        </tr>
      </table>
      {{- else if .Code}}
      <div class="codeblock" style="margin:10px 0 24px 0;padding:16px 12px;border:1px solid {{.Brass}};border-bottom:3px solid {{.Brass}};border-radius:4px;background:{{.Paper}};color:{{.Ink}};text-align:center;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;letter-spacing:6px;">{{.Code}}</div>
      {{- end}}
      {{- with .Ticket}}
      <table role="presentation" class="ticket" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px 0;background:{{$.Paper}};border:1px solid {{$.Brass}};border-radius:6px;">
        <tr><td style="padding:16px 20px 14px 20px;">
          {{- if .Seal}}
          <p class="{{$.SealClass}}" style="margin:0 0 6px 0;font-size:14px;line-height:1.3;font-weight:600;color:{{$.SealColor}};"><span aria-hidden="true" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;">&#9670;</span>&nbsp; {{.Seal}}</p>
          {{- end}}
          <p style="margin:0;line-height:1.1;"><span class="clock {{if .Struck}}muted{{else}}ink{{end}}" style="white-space:nowrap;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:42px;line-height:1.1;color:{{if .Struck}}{{$.TextMuted}};text-decoration:line-through{{else}}{{$.Ink}}{{end}};">{{.Clock}}</span>{{if .Zone}} <span class="muted" style="padding-left:4px;font-size:13px;line-height:1.3;color:{{$.TextMuted}};white-space:nowrap;">{{.Zone}}</span>{{end}}</p>
          <p class="{{if .Struck}}muted{{else}}ink{{end}}" style="margin:4px 0 0 0;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;color:{{if .Struck}}{{$.TextMuted}};text-decoration:line-through{{else}}{{$.Ink}}{{end}};">{{.Day}}</p>
        </td></tr>
        {{- if $.TicketRows}}
        <tr><td style="padding:0 20px;"><div class="perf" style="height:1px;line-height:1px;font-size:1px;border-top:1px dashed {{$.Brass}};">&nbsp;</div></td></tr>
        <tr><td style="padding:12px 20px 14px 20px;">
          {{- range $i, $r := $.TicketRows}}
          {{- if $r.Inline}}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:{{if $i}}8px{{else}}0{{end}} 0 0 0;">
            <tr>
              <td class="muted" style="padding:0;white-space:nowrap;vertical-align:bottom;font-size:14px;line-height:1.5;color:{{$.TextMuted}};">{{$r.Label}}</td>
              <td width="100%" style="padding:0 8px 6px 8px;vertical-align:bottom;"><div class="leader" style="height:1px;line-height:1px;font-size:1px;border-bottom:2px dotted {{$.Brass}};">&nbsp;</div></td>
              <td class="ink" align="right" style="padding:0;white-space:nowrap;vertical-align:bottom;font-size:16px;line-height:1.5;font-weight:600;color:{{$.Ink}};">{{$r.Value}}</td>
            </tr>
          </table>
          {{- else}}
          <p class="muted" style="margin:{{if $i}}8px{{else}}0{{end}} 0 0 0;font-size:14px;line-height:1.5;color:{{$.TextMuted}};">{{$r.Label}}</p>
          <p class="ink" style="margin:0;font-size:16px;line-height:1.5;font-weight:600;color:{{$.Ink}};">{{$r.Value}}</p>
          {{- end}}
          {{- end}}
        </td></tr>
        {{- end}}
      </table>
      {{- end}}
      {{- range .Closing}}
      <p class="ink" style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:{{$.TextMain}};">{{.}}</p>
      {{- end}}
      {{- if and .Button .Button.URL}}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px 0;">
        <tr><td class="btn" align="center" style="background:{{.Ink}};border-radius:4px;">
          <a href="{{.Button.URL}}" style="display:inline-block;padding:14px 28px;font-size:16px;line-height:1.2;font-weight:700;color:{{.Cream}};text-decoration:none;">{{.Button.Label}}</a>
        </td></tr>
      </table>
      {{- end}}
      {{- range .Footnotes}}
      <p class="muted" style="margin:0 0 8px 0;font-size:14px;line-height:1.55;color:{{$.TextMuted}};">{{.}}</p>
      {{- end}}
    </td></tr>
    <tr><td class="px" align="center" style="padding:18px 32px 4px 32px;font-family:'Instrument Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <p class="muted" style="margin:0;font-size:13px;line-height:1.5;color:{{.TextMuted}};"><span class="brass" aria-hidden="true" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:{{.BrassText}};">&#9670;</span>&nbsp; Nava Agenda · agenda de citas para negocios</p>
    </td></tr>
  </table>
</td></tr>
</table>
</main>
</body>
</html>
`
