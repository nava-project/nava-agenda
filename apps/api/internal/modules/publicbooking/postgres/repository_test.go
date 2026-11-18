// Package postgres_test (pruebas de integración, HU-090/HU-091) requiere
// PostgreSQL REAL con todas las migraciones aplicadas (incluida
// 20260911045044_add_barbershop_public_slug.sql) y
// database/testdata/{hu090_reserva_publica.sql,hu091_catalogo_publico.sql}
// cargados. Conéctate como agenda_app (docs/03-desarrollo/
// estrategia-pruebas.md §2 prohíbe mocks para RLS/resolución de tenant sin
// contexto).
//
//	export TEST_DATABASE_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable"
//	go test -race ./internal/modules/publicbooking/postgres/...
package postgres_test

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"nava-agenda/internal/modules/publicbooking"
	publicbookingpostgres "nava-agenda/internal/modules/publicbooking/postgres"
	"nava-agenda/internal/platform/config"
	"nava-agenda/internal/platform/database"
)

const (
	testDatabaseURL = "postgres://agenda_app@localhost:5432/agenda_test?sslmode=disable"

	// Par dedicado de hu090_reserva_publica.sql: shopUno tiene contacto
	// completo y slug, shopDos tiene slug pero sin contacto (contactos
	// NULL, CA-090-04), shopNoPublicable tiene public_slug NULL (existe,
	// pero no es publicable).
	slugUno         = "barberia-hu090-uno"
	slugDos         = "barberia-hu090-dos"
	nameUno         = "Barbería de prueba HU-090 Uno"
	nameDos         = "Barbería de prueba HU-090 Dos"
	contactEmailUno = "contacto.hu090uno@ejemplo.test"
	contactPhoneUno = "+573000000001"

	// Par dedicado de hu091_catalogo_publico.sql (HU-091): slugCatalogoUno
	// tiene un servicio activo+asignado, uno activo sin asignar y uno
	// inactivo+asignado; slugCatalogoDos tiene un único servicio activo y
	// asignado, usado exclusivamente para CA-091-03 (aislamiento de tenant).
	slugCatalogoUno          = "barberia-hu091-uno"
	slugCatalogoDos          = "barberia-hu091-dos"
	servicioActivoAsignadoID = "00910101-0091-0091-0091-009101010101"
	servicioActivoAsignado   = "Corte activo asignado HU-091"
	servicioDosActivoID      = "00910201-0091-0091-0091-009102010201"
	servicioDosActivo        = "Corte activo asignado HU-091 Dos"

	// Par dedicado de hu092_seleccion_profesional.sql (HU-092): slugProfesionalUno
	// tiene un servicio con exactamente un profesional (matriz "1"), uno con dos
	// (matriz "N"), uno sin ninguno (matriz "0") y uno inactivo con un
	// profesional asignado (CA-092-02); slugProfesionalDos existe exclusivamente
	// para el aislamiento de tenant (CA-092-02/CA-092-03).
	slugProfesionalUno             = "barberia-hu092-uno"
	slugProfesionalDos             = "barberia-hu092-dos"
	servicioUnProfesionalID        = "00920101-0092-0092-0092-009201010101"
	servicioVariosID               = "00920102-0092-0092-0092-009201020102"
	servicioSinProfesionalesID     = "00920103-0092-0092-0092-009201030103"
	servicioInactivoID             = "00920104-0092-0092-0092-009201040104"
	servicioDosProfesionalID       = "00920201-0092-0092-0092-009202010201"
	profesionalUnProfesionalID     = "00920011-0092-0092-0092-009200110011"
	profesionalUnProfesionalNombre = "Barbero HU-092 Uno-1"
	profesionalVariosSegundoID     = "00920012-0092-0092-0092-009200120012"

	// DEC-127: Uno-1 tiene descripción y fotografía; Uno-2 no tiene ninguna;
	// Uno-3 tiene fotografía pero ninguna asignación vigente; Dos-1 tiene
	// fotografía de otro negocio.
	profesionalUnProfesionalDescripcion = "Descripción pública HU-092 Uno-1"
	profesionalSinAsignacionID          = "00920014-0092-0092-0092-009200140014"
	profesionalOtraNegocioID            = "00920013-0092-0092-0092-009200130013"
)

func setupTestDB(t *testing.T) *database.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = testDatabaseURL
	}
	cfg := config.Config{
		Environment:              "test",
		DatabaseMaxConns:         10,
		DatabaseMinConns:         2,
		DatabaseMaxConnLifetime:  time.Hour,
		DatabaseMaxConnIdleTime:  30 * time.Minute,
		DatabaseConnectTimeout:   5 * time.Second,
		DatabaseStatementTimeout: 10 * time.Second,
	}
	db, err := database.NewDB(config.DatabaseDSN(url), cfg)
	if err != nil {
		t.Fatalf("database.NewDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestResolveBySlug_ValidSlug_ReturnsPublicProfile(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	profile, found, err := repo.ResolveBySlug(context.Background(), slugUno)
	if err != nil {
		t.Fatalf("ResolveBySlug: %v", err)
	}
	if !found {
		t.Fatal("expected slugUno to resolve")
	}
	if profile.Name != nameUno || profile.Timezone != "America/Bogota" {
		t.Fatalf("unexpected profile: %+v", profile)
	}
	if profile.ContactEmail == nil || *profile.ContactEmail != contactEmailUno {
		t.Fatalf("expected contactEmail=%q, got %v", contactEmailUno, profile.ContactEmail)
	}
	if profile.ContactPhone == nil || *profile.ContactPhone != contactPhoneUno {
		t.Fatalf("expected contactPhone=%q, got %v", contactPhoneUno, profile.ContactPhone)
	}
}

// TestResolveBySlug_IsCaseInsensitive cubre DEC-082: el slug se compara sin
// distinguir mayúsculas (idx_business_public_slug es sobre lower()).
func TestResolveBySlug_IsCaseInsensitive(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	profile, found, err := repo.ResolveBySlug(context.Background(), "BARBERIA-HU090-UNO")
	if err != nil {
		t.Fatalf("ResolveBySlug: %v", err)
	}
	if !found || profile.Name != nameUno {
		t.Fatalf("expected case-insensitive match for shopUno, got found=%v profile=%+v", found, profile)
	}
}

// TestResolveBySlug_NoContact_ReturnsNilPointersNotEmptyStrings cubre
// CA-090-04: shopDos no tiene contacto configurado.
func TestResolveBySlug_NoContact_ReturnsNilPointersNotEmptyStrings(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	profile, found, err := repo.ResolveBySlug(context.Background(), slugDos)
	if err != nil {
		t.Fatalf("ResolveBySlug: %v", err)
	}
	if !found || profile.Name != nameDos {
		t.Fatalf("expected shopDos to resolve, got found=%v profile=%+v", found, profile)
	}
	if profile.ContactEmail != nil || profile.ContactPhone != nil {
		t.Fatalf("expected nil contact pointers, got %+v", profile)
	}
}

// TestResolveBySlug_UnknownSlug_ReturnsNotFound cubre CA-090-02: un slug
// bien formado pero que no existe.
func TestResolveBySlug_UnknownSlug_ReturnsNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	_, found, err := repo.ResolveBySlug(context.Background(), "barberia-que-no-existe")
	if err != nil {
		t.Fatalf("ResolveBySlug: %v", err)
	}
	if found {
		t.Fatal("expected an unknown slug not to resolve")
	}
}

// TestResolveBySlug_MalformedSlug_ReturnsNotFound cubre CA-090-02: una
// forma que ningún public_slug real puede tener (mayúsculas Y símbolos)
// produce la MISMA respuesta que un slug desconocido, nunca un error.
func TestResolveBySlug_MalformedSlug_ReturnsNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	for _, malformed := range []string{"Bad Slug!", "-empieza-con-guion", "termina-con-guion-", "ab"} {
		_, found, err := repo.ResolveBySlug(context.Background(), malformed)
		if err != nil {
			t.Fatalf("ResolveBySlug(%q): unexpected error %v", malformed, err)
		}
		if found {
			t.Fatalf("ResolveBySlug(%q): expected not found, got a match", malformed)
		}
	}
}

// TestResolveBySlug_NotPublicableBusiness_ReturnsNotFound cubre
// CA-090-02/DEC-082: un negocio que EXISTE pero no tiene public_slug
// (no publicable) responde exactamente igual que un slug inexistente.
func TestResolveBySlug_NotPublicableBusiness_ReturnsNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	// El negocio "No Publicable" del fixture no tiene ningún slug propio
	// que probar (public_slug es NULL): confirmamos que ningún slug la
	// alcanza, en particular no por casualidad con el nombre.
	_, found, err := repo.ResolveBySlug(context.Background(), "barberia-de-prueba-hu-090-no-publicable")
	if err != nil {
		t.Fatalf("ResolveBySlug: %v", err)
	}
	if found {
		t.Fatal("expected a business without public_slug never to resolve")
	}
}

// TestResolveBySlug_TenantAIsolatedFromTenantB confirma que resolver un
// slug nunca filtra ni mezcla datos del otro negocio del par (RN-TEN-01):
// cada resolución trae exactamente el perfil de SU propio negocio.
func TestResolveBySlug_TenantAIsolatedFromTenantB(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	uno, foundUno, err := repo.ResolveBySlug(context.Background(), slugUno)
	if err != nil || !foundUno {
		t.Fatalf("ResolveBySlug(slugUno): found=%v err=%v", foundUno, err)
	}
	dos, foundDos, err := repo.ResolveBySlug(context.Background(), slugDos)
	if err != nil || !foundDos {
		t.Fatalf("ResolveBySlug(slugDos): found=%v err=%v", foundDos, err)
	}
	if uno.Name == dos.Name {
		t.Fatalf("test fixture assumption broken: both slugs resolved to the same name %q", uno.Name)
	}
	if dos.ContactEmail != nil {
		t.Fatalf("RN-TEN-01: resolving slugDos leaked shopUno's contactEmail: %+v", dos)
	}
}

// setVocabulary fija el vocabulario del negocio de slug y lo devuelve a los
// valores iniciales al terminar la prueba, para no contaminar a las demás (el
// negocio del fixture es compartida). Escribe como agenda_app dentro de su
// propio tenant, igual que el panel.
func setVocabulary(t *testing.T, db *database.DB, repo *publicbookingpostgres.Repository, slug string, v publicbooking.Vocabulary) {
	t.Helper()
	id, found, err := repo.ResolveBusinessID(context.Background(), slug)
	if err != nil || !found {
		t.Fatalf("ResolveBusinessID(%s): found=%v err=%v", slug, found, err)
	}
	write := func(v publicbooking.Vocabulary) error {
		return db.InTenantTx(context.Background(), database.BusinessID(id), func(ctx context.Context, q database.Queries) error {
			_, err := q.Exec(ctx,
				`UPDATE business
				    SET business_term = $2, business_term_gender = $3,
				        professional_term = $4, professional_term_plural = $5, professional_term_gender = $6
				  WHERE id = $1`,
				id, v.BusinessTerm, v.BusinessTermGender,
				v.ProfessionalTerm, v.ProfessionalTermPlural, v.ProfessionalTermGender,
			)
			return err
		})
	}
	if err := write(v); err != nil {
		t.Fatalf("fijar vocabulario: %v", err)
	}
	t.Cleanup(func() {
		_ = write(publicbooking.Vocabulary{
			BusinessTerm: "barbería", BusinessTermGender: "feminine",
			ProfessionalTerm: "barbero", ProfessionalTermPlural: "barberos",
			ProfessionalTermGender: "masculine",
		})
	})
}

// TestResolveBySlug_Vocabulary_DefaultsAndPerTenant cubre DEC-119: un negocio
// que nunca configuró su vocabulario recibe los valores iniciales, y una que sí
// lo configuró recibe el suyo sin filtrarlo a la otra (RN-TEN-01).
func TestResolveBySlug_Vocabulary_DefaultsAndPerTenant(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	wantDefault := publicbooking.Vocabulary{
		BusinessTerm: "negocio", BusinessTermGender: "masculine",
		ProfessionalTerm: "profesional", ProfessionalTermPlural: "profesionales",
		ProfessionalTermGender: "masculine",
	}
	wantNails := publicbooking.Vocabulary{
		BusinessTerm: "estudio de uñas", BusinessTermGender: "masculine",
		ProfessionalTerm: "manicurista", ProfessionalTermPlural: "manicuristas",
		ProfessionalTermGender: "feminine",
	}

	uno, found, err := repo.ResolveBySlug(context.Background(), slugUno)
	if err != nil || !found {
		t.Fatalf("ResolveBySlug(slugUno): found=%v err=%v", found, err)
	}
	if uno.Vocabulary != wantDefault {
		t.Fatalf("slugUno debe traer el vocabulario inicial: %+v", uno.Vocabulary)
	}

	setVocabulary(t, db, repo, slugDos, wantNails)

	dos, found, err := repo.ResolveBySlug(context.Background(), slugDos)
	if err != nil || !found {
		t.Fatalf("ResolveBySlug(slugDos): found=%v err=%v", found, err)
	}
	if dos.Vocabulary != wantNails {
		t.Fatalf("slugDos vocabulary = %+v, want %+v", dos.Vocabulary, wantNails)
	}
	uno, _, err = repo.ResolveBySlug(context.Background(), slugUno)
	if err != nil {
		t.Fatalf("ResolveBySlug(slugUno): %v", err)
	}
	if uno.Vocabulary != wantDefault {
		t.Fatalf("RN-TEN-01: el vocabulario de slugDos se filtró a slugUno: %+v", uno.Vocabulary)
	}
}

// setLocation fija la ubicación del negocio de slug y la restaura al terminar
// (DEC-130). Escribe como agenda_app dentro de su propio tenant.
func setLocation(t *testing.T, db *database.DB, repo *publicbookingpostgres.Repository, slug string, enabled bool, address *string, lat, lng *float64) {
	t.Helper()
	id, found, err := repo.ResolveBusinessID(context.Background(), slug)
	if err != nil || !found {
		t.Fatalf("ResolveBusinessID(%s): found=%v err=%v", slug, found, err)
	}
	write := func(enabled bool, address *string, lat, lng *float64) error {
		return db.InTenantTx(context.Background(), database.BusinessID(id), func(ctx context.Context, q database.Queries) error {
			_, err := q.Exec(ctx,
				`UPDATE business
				    SET has_physical_location = $2, address = $3, latitude = $4, longitude = $5
				  WHERE id = $1`, id, enabled, address, lat, lng)
			return err
		})
	}
	if err := write(enabled, address, lat, lng); err != nil {
		t.Fatalf("fijar ubicación: %v", err)
	}
	t.Cleanup(func() { _ = write(true, nil, nil, nil) })
}

// TestResolveBySlug_Location_OnlyWhenEnabledAndGeocoded cubre CA-102-02,
// CA-102-03 y CA-102-04 en la capa de datos: la ubicación solo se publica con
// el interruptor activo Y coordenadas, y nunca cruza de un negocio a otra.
func TestResolveBySlug_Location_OnlyWhenEnabledAndGeocoded(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)
	ctx := context.Background()
	addr, lat, lng := "Calle 10 # 5-20, Bogotá", 4.598056, -74.076111

	// Sin dirección capturada (estado inicial): sin sección.
	p, _, err := repo.ResolveBySlug(ctx, slugUno)
	if err != nil {
		t.Fatalf("ResolveBySlug: %v", err)
	}
	if p.Location != nil {
		t.Fatalf("CA-102-03: sin coordenadas no hay ubicación: %+v", p.Location)
	}

	// Interruptor activo con coordenadas: se publica tal cual.
	setLocation(t, db, repo, slugUno, true, &addr, &lat, &lng)
	p, _, _ = repo.ResolveBySlug(ctx, slugUno)
	if p.Location == nil || p.Location.Address != addr || p.Location.Latitude != lat || p.Location.Longitude != lng {
		t.Fatalf("CA-102-04: debe publicar la ubicación guardada: %+v", p.Location)
	}

	// El otro negocio no hereda nada (RN-TEN-01).
	other, _, _ := repo.ResolveBySlug(ctx, slugDos)
	if other.Location != nil {
		t.Fatalf("RN-TEN-01: la ubicación de slugUno se filtró a slugDos: %+v", other.Location)
	}

	// Interruptor apagado: oculta aunque el dato exista (CA-102-02).
	setLocation(t, db, repo, slugUno, false, &addr, &lat, &lng)
	p, _, _ = repo.ResolveBySlug(ctx, slugUno)
	if p.Location != nil {
		t.Fatalf("CA-102-02: con el interruptor apagado no se publica: %+v", p.Location)
	}
}

// TestListPublicServices_ActiveAndAssigned_ExcludesInactiveAndUnassigned
// cubre CA-091-01: de los cuatro servicios del negocio HU-091 Uno (dos
// activos+asignados, uno activo sin asignar, uno inactivo+asignado), solo
// los dos activos+asignados aparecen.
func TestListPublicServices_ActiveAndAssigned_ExcludesInactiveAndUnassigned(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	result, found, err := repo.ListPublicServices(context.Background(), slugCatalogoUno, nil, 20)
	if err != nil {
		t.Fatalf("ListPublicServices: %v", err)
	}
	if !found {
		t.Fatal("expected slugCatalogoUno to resolve")
	}
	if len(result.Items) != 2 {
		t.Fatalf("expected exactly 2 public services (active+assigned only), got %d: %+v", len(result.Items), result.Items)
	}
	svc := result.Items[0]
	if svc.ID != servicioActivoAsignadoID || svc.Name != servicioActivoAsignado {
		t.Fatalf("unexpected first service: %+v", svc)
	}
	if svc.DurationMinutes != 30 || svc.PriceCents != 3500000 || svc.Currency != "COP" {
		t.Fatalf("unexpected service fields: %+v", svc)
	}
	if result.NextCursor != "" {
		t.Fatalf("expected no next page for a full 20-item page with only 2 rows, got cursor %q", result.NextCursor)
	}
}

// TestListPublicServices_UnknownOrNotPublicSlug_ReturnsNotFound cubre la
// misma respuesta uniforme que ResolveBySlug (CA-090-02, reutilizada aquí).
func TestListPublicServices_UnknownOrNotPublicSlug_ReturnsNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	_, found, err := repo.ListPublicServices(context.Background(), "barberia-que-no-existe", nil, 20)
	if err != nil {
		t.Fatalf("ListPublicServices: %v", err)
	}
	if found {
		t.Fatal("expected an unknown slug not to resolve")
	}
}

// TestListPublicServices_TenantAIsolatedFromTenantB cubre CA-091-03: el
// catálogo de un negocio nunca incluye el servicio de la otra, verificado
// con dos tenants reales.
func TestListPublicServices_TenantAIsolatedFromTenantB(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	uno, foundUno, err := repo.ListPublicServices(context.Background(), slugCatalogoUno, nil, 20)
	if err != nil || !foundUno {
		t.Fatalf("ListPublicServices(slugCatalogoUno): found=%v err=%v", foundUno, err)
	}
	dos, foundDos, err := repo.ListPublicServices(context.Background(), slugCatalogoDos, nil, 20)
	if err != nil || !foundDos {
		t.Fatalf("ListPublicServices(slugCatalogoDos): found=%v err=%v", foundDos, err)
	}

	for _, svc := range uno.Items {
		if svc.ID == servicioDosActivoID {
			t.Fatalf("RN-TEN-01: slugCatalogoUno's catalog leaked shopDos's service: %+v", svc)
		}
	}
	if len(dos.Items) != 1 || dos.Items[0].ID != servicioDosActivoID || dos.Items[0].Name != servicioDosActivo {
		t.Fatalf("unexpected shopDos catalog: %+v", dos.Items)
	}
}

// TestListPublicServices_LimitOne_PaginatesAcrossTwoPages cubre la
// paginación por cursor del catálogo público: con límite 1, el negocio
// HU-091 Uno (exactamente dos servicios públicos) entrega su primera
// página con nextCursor, y la segunda página (pedida con ese cursor) trae
// el segundo servicio sin repetir el primero y sin nextCursor (ya no queda
// una tercera página).
func TestListPublicServices_LimitOne_PaginatesAcrossTwoPages(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	first, found, err := repo.ListPublicServices(context.Background(), slugCatalogoUno, nil, 1)
	if err != nil || !found || len(first.Items) != 1 {
		t.Fatalf("ListPublicServices (first page): found=%v items=%d err=%v", found, len(first.Items), err)
	}
	if first.NextCursor == "" {
		t.Fatal("expected a nextCursor: a second public service exists")
	}
	if first.Items[0].ID != servicioActivoAsignadoID {
		t.Fatalf("expected the first page to be the earliest-created service, got %+v", first.Items[0])
	}

	firstCursor, err := publicbooking.DecodeServiceCursor(first.NextCursor)
	if err != nil {
		t.Fatalf("DecodeServiceCursor(first.NextCursor): %v", err)
	}
	second, found, err := repo.ListPublicServices(context.Background(), slugCatalogoUno, &firstCursor, 1)
	if err != nil || !found || len(second.Items) != 1 {
		t.Fatalf("ListPublicServices (second page): found=%v items=%d err=%v", found, len(second.Items), err)
	}
	if second.Items[0].ID == first.Items[0].ID {
		t.Fatalf("expected the second page not to repeat the first item, got %+v twice", second.Items[0])
	}
	if second.NextCursor != "" {
		t.Fatalf("expected no nextCursor on the last page, got %q", second.NextCursor)
	}
}

// TestListPublicProfessionals_OneProfessional_ReturnsSingleItem cubre CA-092-01 (caso
// "1" de la matriz 0/1/N): exactamente un profesional elegible.
func TestListPublicProfessionals_OneProfessional_ReturnsSingleItem(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	result, found, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalUno, servicioUnProfesionalID)
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if !found {
		t.Fatal("expected slugProfesionalUno to resolve")
	}
	if len(result.Items) != 1 || result.Items[0].ID != profesionalUnProfesionalID || result.Items[0].FullName != profesionalUnProfesionalNombre {
		t.Fatalf("expected exactly one professional (%s), got %+v", profesionalUnProfesionalID, result.Items)
	}
}

// TestListPublicProfessionals_ManyProfessionals_ReturnsAllInStableOrder cubre CA-092-01
// (caso "N"): varios profesionales elegibles, en orden estable
// (created_at de la asignación, id del profesional).
func TestListPublicProfessionals_ManyProfessionals_ReturnsAllInStableOrder(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	result, found, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalUno, servicioVariosID)
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if !found {
		t.Fatal("expected slugProfesionalUno to resolve")
	}
	if len(result.Items) != 2 {
		t.Fatalf("expected exactly 2 professionals, got %+v", result.Items)
	}
	if result.Items[0].ID != profesionalUnProfesionalID || result.Items[1].ID != profesionalVariosSegundoID {
		t.Fatalf("expected a stable order (%s, %s), got %+v", profesionalUnProfesionalID, profesionalVariosSegundoID, result.Items)
	}
}

// TestListPublicProfessionals_ZeroProfessionals_ReturnsEmptySuccess cubre CA-092-01
// (caso "0"): un servicio activo sin ninguna asignación es un resultado
// exitoso vacío, nunca un error.
func TestListPublicProfessionals_ZeroProfessionals_ReturnsEmptySuccess(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	result, found, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalUno, servicioSinProfesionalesID)
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if !found {
		t.Fatal("expected slugProfesionalUno to resolve")
	}
	if len(result.Items) != 0 {
		t.Fatalf("expected zero professionals, got %+v", result.Items)
	}
}

// TestListPublicProfessionals_InactiveService_ReturnsEmpty cubre CA-092-02: un
// servicio inactivo nunca expone sus profesionales asignados, aunque la
// asignación exista.
func TestListPublicProfessionals_InactiveService_ReturnsEmpty(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	result, found, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalUno, servicioInactivoID)
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if !found {
		t.Fatal("expected slugProfesionalUno to resolve")
	}
	if len(result.Items) != 0 {
		t.Fatalf("expected zero professionals for an inactive service, got %+v", result.Items)
	}
}

// TestListPublicProfessionals_MalformedServiceID_ReturnsEmptySuccess cubre
// CA-092-03: un serviceID sin forma de UUID nunca produce un error de tipo
// de PostgreSQL, y el negocio sigue resolviendo.
func TestListPublicProfessionals_MalformedServiceID_ReturnsEmptySuccess(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	result, found, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalUno, "no-es-un-uuid")
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if !found {
		t.Fatal("expected slugProfesionalUno to resolve regardless of a malformed serviceID")
	}
	if len(result.Items) != 0 {
		t.Fatalf("expected zero professionals for a malformed serviceID, got %+v", result.Items)
	}
}

// TestListPublicProfessionals_UnknownSlug_ReturnsNotFound cubre la misma
// respuesta uniforme que ResolveBySlug (CA-090-02, reutilizada aquí).
func TestListPublicProfessionals_UnknownSlug_ReturnsNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	_, found, err := repo.ListPublicProfessionals(context.Background(), "barberia-que-no-existe", servicioUnProfesionalID)
	if err != nil {
		t.Fatalf("ListPublicProfessionals: %v", err)
	}
	if found {
		t.Fatal("expected an unknown slug not to resolve")
	}
}

// TestListPublicProfessionals_TenantAIsolatedFromTenantB cubre CA-092-02/
// CA-092-03: un serviceId del negocio Dos nunca devuelve profesionales al
// resolverse a través del slug del negocio Uno, y viceversa, verificado
// con dos tenants reales y asignaciones cruzadas.
func TestListPublicProfessionals_TenantAIsolatedFromTenantB(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	crossUno, foundUno, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalUno, servicioDosProfesionalID)
	if err != nil || !foundUno {
		t.Fatalf("ListPublicProfessionals(slugProfesionalUno, servicioDosProfesionalID): found=%v err=%v", foundUno, err)
	}
	if len(crossUno.Items) != 0 {
		t.Fatalf("RN-TEN-01: slugProfesionalUno exposed business Dos's service professionals: %+v", crossUno.Items)
	}

	crossDos, foundDos, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalDos, servicioUnProfesionalID)
	if err != nil || !foundDos {
		t.Fatalf("ListPublicProfessionals(slugProfesionalDos, servicioUnProfesionalID): found=%v err=%v", foundDos, err)
	}
	if len(crossDos.Items) != 0 {
		t.Fatalf("RN-TEN-01: slugProfesionalDos exposed business Uno's service professionals: %+v", crossDos.Items)
	}

	// Confirma además que cada negocio SÍ resuelve su propio servicio
	// (el aislamiento no es un falso negativo generalizado).
	own, foundOwn, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalDos, servicioDosProfesionalID)
	if err != nil || !foundOwn || len(own.Items) != 1 {
		t.Fatalf("ListPublicProfessionals(slugProfesionalDos, servicioDosProfesionalID): found=%v items=%d err=%v", foundOwn, len(own.Items), err)
	}
}

// --- DEC-127: descripción y fotografía públicas ----------------------------

// TestListPublicProfessionals_DescriptionAndPhotoVersion_AreProjected comprueba que
// la lista pública incluye la descripción y la versión de la fotografía de
// quien las tiene y null (nil) para quien no.
func TestListPublicProfessionals_DescriptionAndPhotoVersion_AreProjected(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	result, found, err := repo.ListPublicProfessionals(context.Background(), slugProfesionalUno, servicioVariosID)
	if err != nil || !found {
		t.Fatalf("ListPublicProfessionals: found=%v err=%v", found, err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("expected 2 professionals, got %+v", result.Items)
	}

	withBoth, without := result.Items[0], result.Items[1]
	if withBoth.ID != profesionalUnProfesionalID || withBoth.Description == nil || *withBoth.Description != profesionalUnProfesionalDescripcion {
		t.Fatalf("expected Uno-1 with its description, got %+v", withBoth)
	}
	if withBoth.PhotoUpdatedAt == nil {
		t.Fatalf("expected Uno-1 with a photo version, got %+v", withBoth)
	}
	if without.ID != profesionalVariosSegundoID || without.Description != nil || without.PhotoUpdatedAt != nil {
		t.Fatalf("expected Uno-2 with neither description nor photo, got %+v", without)
	}
}

func TestGetPublicProfessionalPhoto_EligibleProfessional_ReturnsBytesAndContentType(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	photo, found, err := repo.GetPublicProfessionalPhoto(context.Background(), slugProfesionalUno, profesionalUnProfesionalID)
	if err != nil || !found {
		t.Fatalf("GetPublicProfessionalPhoto: found=%v err=%v", found, err)
	}
	if photo.ContentType != "image/png" || len(photo.Data) == 0 || photo.UpdatedAt.IsZero() {
		t.Fatalf("expected a PNG with bytes and a version, got %+v", photo)
	}
}

// Sin fotografía, sin asignación vigente, de otro negocio, con slug
// desconocido o con un identificador inexistente: siempre found=false, sin
// distinguir la causa.
func TestGetPublicProfessionalPhoto_NotVisible_ReturnsNotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	for name, tc := range map[string]struct{ slug, professionalID string }{
		"sin fotografía":                     {slugProfesionalUno, profesionalVariosSegundoID},
		"con fotografía pero sin asignación": {slugProfesionalUno, profesionalSinAsignacionID},
		"profesional de otro negocio":        {slugProfesionalUno, profesionalOtraNegocioID},
		"slug desconocido":                   {"no-existe-hu127", profesionalUnProfesionalID},
		"profesional inexistente":            {slugProfesionalUno, "99999999-9999-4999-8999-999999999999"},
	} {
		t.Run(name, func(t *testing.T) {
			photo, found, err := repo.GetPublicProfessionalPhoto(context.Background(), tc.slug, tc.professionalID)
			if err != nil {
				t.Fatalf("GetPublicProfessionalPhoto: %v", err)
			}
			if found || len(photo.Data) != 0 {
				t.Fatalf("expected found=false with no bytes, got found=%v %+v", found, photo)
			}
		})
	}
}

// El profesional del negocio Dos sí es elegible a través de SU slug: el
// aislamiento depende del slug, no de que la imagen no exista.
func TestGetPublicProfessionalPhoto_OwnTenant_ServesItsOwnProfessional(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)

	_, found, err := repo.GetPublicProfessionalPhoto(context.Background(), slugProfesionalDos, profesionalOtraNegocioID)
	if err != nil || !found {
		t.Fatalf("expected shop Dos to serve its own professional's photo, found=%v err=%v", found, err)
	}
}

// DEC-128 §5 / CA-100-04: la lista pública trae el promedio y el total de las
// reseñas no ocultas de cada profesional. Las reseñas se insertan directo en SQL (su
// alta vive en el módulo reviews). La base persistente puede traer reseñas de
// corridas anteriores: se comprueban diferencias, no valores absolutos.
func TestListPublicProfessionals_RatingCountsOnlyVisibleReviews(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)
	ctx := context.Background()
	const shopUno = "00920001-0092-0092-0092-009200010001"

	read := func() (count int, avg *float64) {
		t.Helper()
		result, found, err := repo.ListPublicProfessionals(ctx, slugProfesionalUno, servicioVariosID)
		if err != nil || !found {
			t.Fatalf("ListPublicProfessionals: found=%v err=%v", found, err)
		}
		for _, b := range result.Items {
			if b.ID == profesionalVariosSegundoID {
				return b.RatingCount, b.Rating
			}
		}
		t.Fatal("el profesional Uno-2 debe estar en la lista")
		return 0, nil
	}
	before, _ := read()

	err := db.InTenantTx(ctx, database.BusinessID(shopUno), func(ctx context.Context, q database.Queries) error {
		for i, c := range []struct {
			rating int
			hidden bool
		}{{5, false}, {5, false}, {1, true}} {
			var serviceID, customerID, appointmentID string
			if err := q.QueryRow(ctx,
				`INSERT INTO service (business_id, name, duration_minutes, price_amount, price_currency)
				 VALUES ($1, $2, 30, 20000, 'COP') RETURNING id`, shopUno, "Servicio reseña "+strconv.FormatInt(time.Now().UnixNano(), 10)).Scan(&serviceID); err != nil {
				return err
			}
			if err := q.QueryRow(ctx,
				`INSERT INTO customer (business_id, full_name) VALUES ($1, 'Cliente de prueba') RETURNING id`, shopUno).Scan(&customerID); err != nil {
				return err
			}
			starts := time.Date(2032, 1, 1, 8, 0, 0, 0, time.UTC).AddDate(0, 0, int(time.Now().UnixNano()%3000)).Add(time.Duration(i) * time.Hour)
			if err := q.QueryRow(ctx,
				`INSERT INTO appointment (business_id, professional_id, service_id, customer_id, attendee_name, starts_at, ends_at,
				                          status, origin, resolved_at, service_name_snapshot, duration_minutes_snapshot,
				                          price_amount_snapshot, price_currency_snapshot)
				 VALUES ($1, $2, $3, $4, 'Cliente de prueba', $5, $6, 'completed', 'manual', now(), 'Servicio', 30, 20000, 'COP')
				 RETURNING id`, shopUno, profesionalVariosSegundoID, serviceID, customerID, starts, starts.Add(30*time.Minute)).Scan(&appointmentID); err != nil {
				return err
			}
			if _, err := q.Exec(ctx,
				`INSERT INTO professional_review (business_id, professional_id, appointment_id, rating, hidden_at)
				 VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)`,
				shopUno, profesionalVariosSegundoID, appointmentID, c.rating, c.hidden); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("sembrar reseñas: %v", err)
	}

	after, avg := read()
	if after != before+2 {
		t.Fatalf("ratingCount = %d, se esperaban %d (la oculta no cuenta)", after, before+2)
	}
	if avg == nil || *avg < 1 || *avg > 5 {
		t.Fatalf("rating = %v, se esperaba un promedio entre 1 y 5", avg)
	}

	// El profesional sin reseñas visibles del otro negocio no hereda nada.
	other, _, _ := repo.ListPublicProfessionals(ctx, slugProfesionalDos, servicioDosProfesionalID)
	for _, b := range other.Items {
		if b.ID == profesionalVariosSegundoID {
			t.Fatal("la lista de otro negocio no debe incluir al profesional de Uno")
		}
	}
}

// TestResolveBySlug_OffersHomeService_FollowsTheShopSwitchOnly cubre DEC-131 en la
// capa de datos: el perfil público refleja el interruptor de SU negocio y nunca el
// de otra (RN-TEN-01).
func TestResolveBySlug_OffersHomeService_FollowsTheShopSwitchOnly(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)
	ctx := context.Background()

	before, _, err := repo.ResolveBySlug(ctx, slugUno)
	if err != nil || before.OffersHomeService {
		t.Fatalf("un negocio nuevo no ofrece domicilio: %+v err=%v", before, err)
	}

	id, found, err := repo.ResolveBusinessID(ctx, slugUno)
	if err != nil || !found {
		t.Fatalf("ResolveBusinessID: found=%v err=%v", found, err)
	}
	setOffers := func(on bool) error {
		return db.InTenantTx(ctx, database.BusinessID(id), func(ctx context.Context, q database.Queries) error {
			_, err := q.Exec(ctx, `UPDATE business SET offers_home_service = $2 WHERE id = $1`, id, on)
			return err
		})
	}
	if err := setOffers(true); err != nil {
		t.Fatalf("encender: %v", err)
	}
	t.Cleanup(func() { _ = setOffers(false) })

	p, _, _ := repo.ResolveBySlug(ctx, slugUno)
	if !p.OffersHomeService {
		t.Fatal("CA-103-02: con el interruptor encendido el perfil debe publicarlo")
	}
	other, _, _ := repo.ResolveBySlug(ctx, slugDos)
	if other.OffersHomeService {
		t.Fatal("RN-TEN-01: el interruptor de slugUno se filtró a slugDos")
	}
}

// TestResolveBySlug_BrandAccent_FollowsTheShopOnly cubre DEC-171 en la capa de
// datos: el perfil público trae el color de SU negocio y nunca el de otra
// (RN-TEN-01). Un negocio nuevo conserva el latón inicial.
func TestResolveBySlug_BrandAccent_FollowsTheShopOnly(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)
	ctx := context.Background()

	before, _, err := repo.ResolveBySlug(ctx, slugUno)
	if err != nil || before.BrandAccent != "brass" {
		t.Fatalf("un negocio nuevo usa latón: %+v err=%v", before, err)
	}

	id, found, err := repo.ResolveBusinessID(ctx, slugUno)
	if err != nil || !found {
		t.Fatalf("ResolveBusinessID: found=%v err=%v", found, err)
	}
	setAccent := func(accent string) error {
		return db.InTenantTx(ctx, database.BusinessID(id), func(ctx context.Context, q database.Queries) error {
			_, err := q.Exec(ctx, `UPDATE business SET brand_accent = $2 WHERE id = $1`, id, accent)
			return err
		})
	}
	if err := setAccent("ruby"); err != nil {
		t.Fatalf("cambiar acento: %v", err)
	}
	t.Cleanup(func() { _ = setAccent("brass") })

	p, _, _ := repo.ResolveBySlug(ctx, slugUno)
	if p.BrandAccent != "ruby" {
		t.Fatalf("DEC-171: el perfil debe publicar el acento elegido, got %q", p.BrandAccent)
	}
	other, _, _ := repo.ResolveBySlug(ctx, slugDos)
	if other.BrandAccent != "brass" {
		t.Fatalf("RN-TEN-01: el acento de slugUno se filtró a slugDos: %q", other.BrandAccent)
	}
}

// TestResolveBySlug_GooglePlaceID_FollowsTheShopOnly cubre DEC-129 en la capa de
// datos: el perfil que usa el servidor trae la ficha de SU negocio y nunca la de
// otra (RN-TEN-01); el DTO público no la expone (contract_test.go).
func TestResolveBySlug_GooglePlaceID_FollowsTheShopOnly(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)
	ctx := context.Background()

	before, _, err := repo.ResolveBySlug(ctx, slugUno)
	if err != nil || before.GooglePlaceID != nil {
		t.Fatalf("un negocio nuevo no tiene ficha: %+v err=%v", before, err)
	}

	id, found, err := repo.ResolveBusinessID(ctx, slugUno)
	if err != nil || !found {
		t.Fatalf("ResolveBusinessID: found=%v err=%v", found, err)
	}
	set := func(placeID *string) error {
		return db.InTenantTx(ctx, database.BusinessID(id), func(ctx context.Context, q database.Queries) error {
			_, err := q.Exec(ctx, `UPDATE business SET google_place_id = $2 WHERE id = $1`, id, placeID)
			return err
		})
	}
	want := "ChIJN1t_tDeuEmsRUsoyG83frY4"
	if err := set(&want); err != nil {
		t.Fatalf("guardar ficha: %v", err)
	}
	t.Cleanup(func() { _ = set(nil) })

	p, _, _ := repo.ResolveBySlug(ctx, slugUno)
	if p.GooglePlaceID == nil || *p.GooglePlaceID != want {
		t.Fatalf("CA-101-02: el perfil debe traer la ficha configurada: %v", p.GooglePlaceID)
	}
	other, _, _ := repo.ResolveBySlug(ctx, slugDos)
	if other.GooglePlaceID != nil {
		t.Fatalf("RN-TEN-01: la ficha de slugUno se filtró a slugDos: %q", *other.GooglePlaceID)
	}
}

// TestResolveBySlug_OpeningHours_FollowsTheShopOnly cubre HU-107 en la capa de
// datos: el perfil trae el horario de SU negocio, ordenado y con 24:00 como
// 1440, y nunca el de otra (RN-TEN-01). Sin horario, la lista es vacía.
func TestResolveBySlug_OpeningHours_FollowsTheShopOnly(t *testing.T) {
	db := setupTestDB(t)
	repo := publicbookingpostgres.New(db)
	ctx := context.Background()

	before, _, err := repo.ResolveBySlug(ctx, slugUno)
	if err != nil || len(before.OpeningHours) != 0 || before.OpeningHours == nil || before.ClosedOnHolidays {
		t.Fatalf("un negocio nuevo no tiene horario (lista vacía, no nil): %+v err=%v", before.OpeningHours, err)
	}

	id, found, err := repo.ResolveBusinessID(ctx, slugUno)
	if err != nil || !found {
		t.Fatalf("ResolveBusinessID: found=%v err=%v", found, err)
	}
	exec := func(sql string) error {
		return db.InTenantTx(ctx, database.BusinessID(id), func(ctx context.Context, q database.Queries) error {
			_, err := q.Exec(ctx, sql, id)
			return err
		})
	}
	if err := exec(`
		WITH s AS (UPDATE business SET closed_on_holidays = true WHERE id = $1 RETURNING id)
		INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
		SELECT s.id, v.d, v.o::time, v.c::time FROM s,
		       (VALUES (5, '20:00', '24:00'), (1, '14:00', '19:00'), (1, '09:00', '12:00')) AS v(d, o, c)`); err != nil {
		t.Fatalf("guardar horario: %v", err)
	}
	t.Cleanup(func() {
		_ = exec(`WITH s AS (UPDATE business SET closed_on_holidays = false WHERE id = $1 RETURNING id)
		          DELETE FROM business_opening_hour USING s WHERE business_opening_hour.business_id = s.id`)
	})

	p, _, err := repo.ResolveBySlug(ctx, slugUno)
	want := []publicbooking.OpeningSegment{
		{Weekday: 1, Opens: 540, Closes: 720}, {Weekday: 1, Opens: 840, Closes: 1140}, {Weekday: 5, Opens: 1200, Closes: 1440},
	}
	if err != nil || !p.ClosedOnHolidays || len(p.OpeningHours) != 3 {
		t.Fatalf("perfil con horario: %+v err=%v", p, err)
	}
	for i := range want {
		if p.OpeningHours[i] != want[i] {
			t.Fatalf("tramos ordenados por día y apertura: got %+v want %+v", p.OpeningHours, want)
		}
	}
	other, _, _ := repo.ResolveBySlug(ctx, slugDos)
	if len(other.OpeningHours) != 0 || other.ClosedOnHolidays {
		t.Fatalf("RN-TEN-01: el horario de slugUno se filtró a slugDos: %+v", other.OpeningHours)
	}
}
