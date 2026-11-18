// Pruebas del caso de uso de ubicación (DEC-130, HU-102) en aislamiento: un
// geocodificador doble y un repositorio en memoria. La persistencia real, el
// aislamiento entre tenants y las restricciones CHECK se prueban contra
// PostgreSQL en postgres/brand_repository_test.go.
package shops_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"nava-agenda/internal/modules/shops"
)

type fakeGeocoder struct {
	point shops.Coordinates
	err   error
	calls []string
}

func (f *fakeGeocoder) Geocode(_ context.Context, address string) (shops.Coordinates, error) {
	f.calls = append(f.calls, address)
	return f.point, f.err
}

func ptr[T any](v T) *T { return &v }

func TestLocationPatch_NoChange_DoesNotTouchLocationNorGeocode(t *testing.T) {
	repo := &fakeBrandRepository{updateResult: shops.BrandUpdateResult{Found: true}}
	geo := &fakeGeocoder{}

	if _, err := shops.NewBrandService(repo, geo).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got := repo.updateCalls[0].location
	if got.ReplaceAddress || got.HasPhysicalLocation != nil || got.Address != nil {
		t.Fatalf("un parche vacío no debe pedir cambios de ubicación: %+v", got)
	}
	if len(geo.calls) != 0 {
		t.Fatalf("sin dirección nueva no se geocodifica, hubo %d llamadas", len(geo.calls))
	}
}

func TestLocationPatch_NewAddress_GeocodesOnceAndWritesCoordinates(t *testing.T) {
	repo := &fakeBrandRepository{getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}
	geo := &fakeGeocoder{point: shops.Coordinates{Latitude: 4.598056, Longitude: -74.076111}}

	_, err := shops.NewBrandService(repo, geo).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
		AddressSet: true, Address: ptr("  Calle 10   # 5-20,  Bogotá "),
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if len(geo.calls) != 1 || geo.calls[0] != "Calle 10 # 5-20, Bogotá" {
		t.Fatalf("debe geocodificar UNA vez la dirección normalizada, llamadas: %q", geo.calls)
	}
	w := repo.updateCalls[0].location
	if !w.ReplaceAddress || w.Address == nil || *w.Address != "Calle 10 # 5-20, Bogotá" ||
		w.Latitude == nil || *w.Latitude != 4.598056 || w.Longitude == nil || *w.Longitude != -74.076111 {
		t.Fatalf("debe escribir dirección normalizada y coordenadas: %+v", w)
	}
}

func TestLocationPatch_SameAddressAlreadyGeocoded_ReusesCoordinatesWithoutGeocoding(t *testing.T) {
	current := validBrand()
	current.Location = shops.Location{
		HasPhysicalLocation: true, Address: ptr("Calle 10 # 5-20, Bogotá"),
		Latitude: ptr(4.598056), Longitude: ptr(-74.076111),
	}
	repo := &fakeBrandRepository{getBrand: current, getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}
	geo := &fakeGeocoder{err: errors.New("no debió llamarse")}

	if _, err := shops.NewBrandService(repo, geo).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
		AddressSet: true, Address: ptr("Calle 10 # 5-20, Bogotá "),
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if len(geo.calls) != 0 {
		t.Fatalf("la misma dirección ya geocodificada no debe consultar al proveedor")
	}
	w := repo.updateCalls[0].location
	if w.Latitude == nil || *w.Latitude != 4.598056 {
		t.Fatalf("debe conservar las coordenadas guardadas: %+v", w)
	}
}

func TestLocationPatch_UnresolvableOrUnavailable_Returns422AndNeverWrites(t *testing.T) {
	for name, geoErr := range map[string]error{
		"no encontrada o ambigua": shops.ErrAddressUnresolvable,
		"proveedor no disponible": shops.ErrGeocoderUnavailable,
	} {
		t.Run(name, func(t *testing.T) {
			repo := &fakeBrandRepository{getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}
			geo := &fakeGeocoder{err: geoErr}

			_, err := shops.NewBrandService(repo, geo).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
				AddressSet: true, Address: ptr("Ninguna parte 999"),
			})
			assertValidation(t, err)
			if len(repo.updateCalls) != 0 {
				t.Fatal("CA-102-01: una dirección que no se geocodifica no debe escribir nada (ni la marca)")
			}
		})
	}
}

func TestLocationPatch_NoGeocoderConfigured_RejectsNewAddressButAllowsRest(t *testing.T) {
	repo := &fakeBrandRepository{getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}
	svc := shops.NewBrandService(repo, nil)

	_, err := svc.Update(context.Background(), shopID, validBrand(), shops.LocationPatch{AddressSet: true, Address: ptr("Calle 10 # 5-20")})
	assertValidation(t, err)

	if _, err := svc.Update(context.Background(), shopID, validBrand(), shops.LocationPatch{HasPhysicalLocation: ptr(false)}); err != nil {
		t.Fatalf("apagar el interruptor no necesita geocodificador: %v", err)
	}
}

func TestLocationPatch_ClearAddress_ClearsCoordinatesToo(t *testing.T) {
	for name, address := range map[string]*string{"null": nil, "solo espacios": ptr("   ")} {
		t.Run(name, func(t *testing.T) {
			repo := &fakeBrandRepository{updateResult: shops.BrandUpdateResult{Found: true}}
			geo := &fakeGeocoder{}

			if _, err := shops.NewBrandService(repo, geo).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
				AddressSet: true, Address: address,
			}); err != nil {
				t.Fatalf("Update: %v", err)
			}
			w := repo.updateCalls[0].location
			if !w.ReplaceAddress || w.Address != nil || w.Latitude != nil || w.Longitude != nil {
				t.Fatalf("quitar la dirección debe quitar también las coordenadas: %+v", w)
			}
			if len(geo.calls) != 0 {
				t.Fatal("quitar la dirección no geocodifica")
			}
		})
	}
}

func TestLocationPatch_ToggleOnly_KeepsAddressAndCoordinates(t *testing.T) {
	repo := &fakeBrandRepository{updateResult: shops.BrandUpdateResult{Found: true}}

	if _, err := shops.NewBrandService(repo, &fakeGeocoder{}).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
		HasPhysicalLocation: ptr(false),
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	w := repo.updateCalls[0].location
	if w.HasPhysicalLocation == nil || *w.HasPhysicalLocation || w.ReplaceAddress {
		t.Fatalf("CA-102-05: apagar solo cambia el interruptor, no la dirección: %+v", w)
	}
}

func TestLocationPatch_AddressTooLong_ReturnsValidation(t *testing.T) {
	repo := &fakeBrandRepository{getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}

	_, err := shops.NewBrandService(repo, &fakeGeocoder{}).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
		AddressSet: true, Address: ptr(strings.Repeat("ñ", shops.MaxAddressLength+1)),
	})
	assertValidation(t, err)
	if len(repo.updateCalls) != 0 {
		t.Fatal("una dirección demasiado larga no debe escribir")
	}
}

func TestLocation_Visible(t *testing.T) {
	full := shops.Location{HasPhysicalLocation: true, Address: ptr("x"), Latitude: ptr(1.0), Longitude: ptr(2.0)}
	if !full.Visible() {
		t.Fatal("interruptor activo con coordenadas debe ser visible")
	}
	off := full
	off.HasPhysicalLocation = false
	if off.Visible() {
		t.Fatal("CA-102-02: con el interruptor apagado no se muestra aunque haya coordenadas")
	}
	noCoords := shops.Location{HasPhysicalLocation: true, Address: ptr("x")}
	if noCoords.Visible() {
		t.Fatal("CA-102-03: sin coordenadas no se muestra")
	}
}

// DEC-170: el punto que el dueño ajusta a mano en el mapa manda sobre la
// geocodificación y se guarda tal cual junto a la dirección escrita.
func TestLocationPatch_ManualPin_WritesThatPointWithoutGeocoding(t *testing.T) {
	repo := &fakeBrandRepository{getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}
	geo := &fakeGeocoder{err: errors.New("no debió llamarse")}

	_, err := shops.NewBrandService(repo, geo).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
		AddressSet: true, Address: ptr(" Calle 15 Norte # 12-57,  Armenia "),
		Latitude: ptr(4.553358), Longitude: ptr(-75.656683),
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if len(geo.calls) != 0 {
		t.Fatalf("con un punto elegido a mano no se geocodifica, hubo %d llamadas", len(geo.calls))
	}
	w := repo.updateCalls[0].location
	if !w.ReplaceAddress || w.Address == nil || *w.Address != "Calle 15 Norte # 12-57, Armenia" ||
		w.Latitude == nil || *w.Latitude != 4.553358 || w.Longitude == nil || *w.Longitude != -75.656683 {
		t.Fatalf("debe escribir la dirección normalizada y el punto elegido: %+v", w)
	}
}

// Ajustar solo el pin, con la misma dirección ya ubicada, reemplaza el punto.
func TestLocationPatch_ManualPin_SameAddress_MovesThePoint(t *testing.T) {
	current := validBrand()
	current.Location = shops.Location{
		HasPhysicalLocation: true, Address: ptr("Calle 10 # 5-20, Bogotá"),
		Latitude: ptr(4.598056), Longitude: ptr(-74.076111),
	}
	repo := &fakeBrandRepository{getBrand: current, getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}

	if _, err := shops.NewBrandService(repo, &fakeGeocoder{}).Update(context.Background(), shopID, validBrand(), shops.LocationPatch{
		AddressSet: true, Address: ptr("Calle 10 # 5-20, Bogotá"),
		Latitude: ptr(4.6), Longitude: ptr(-74.08),
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	w := repo.updateCalls[0].location
	if *w.Latitude != 4.6 || *w.Longitude != -74.08 {
		t.Fatalf("el punto ajustado debe reemplazar al guardado: %+v", w)
	}
}

func TestLocationPatch_ManualPin_InvalidCombinations_Return422AndNeverWrite(t *testing.T) {
	cases := map[string]shops.LocationPatch{
		"solo latitud":           {AddressSet: true, Address: ptr("Calle 1"), Latitude: ptr(4.6)},
		"solo longitud":          {AddressSet: true, Address: ptr("Calle 1"), Longitude: ptr(-74.0)},
		"latitud fuera de rango": {AddressSet: true, Address: ptr("Calle 1"), Latitude: ptr(90.5), Longitude: ptr(-74.0)},
		"longitud fuera de rango": {AddressSet: true, Address: ptr("Calle 1"), Latitude: ptr(4.6),
			Longitude: ptr(-180.5)},
		"sin dirección en el parche": {Latitude: ptr(4.6), Longitude: ptr(-74.0)},
		"quitando la dirección":      {AddressSet: true, Address: nil, Latitude: ptr(4.6), Longitude: ptr(-74.0)},
		"dirección en blanco":        {AddressSet: true, Address: ptr("   "), Latitude: ptr(4.6), Longitude: ptr(-74.0)},
	}
	for name, patch := range cases {
		t.Run(name, func(t *testing.T) {
			repo := &fakeBrandRepository{getFound: true, updateResult: shops.BrandUpdateResult{Found: true}}
			geo := &fakeGeocoder{}
			_, err := shops.NewBrandService(repo, geo).Update(context.Background(), shopID, validBrand(), patch)
			assertValidation(t, err)
			if len(repo.updateCalls) != 0 || len(geo.calls) != 0 {
				t.Fatalf("un punto inválido no escribe ni geocodifica: writes=%d geo=%d", len(repo.updateCalls), len(geo.calls))
			}
		})
	}
}
