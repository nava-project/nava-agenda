package shops

import (
	"context"
	"errors"
	"fmt"

	"nava-agenda/internal/platform/apperr"
)

// BrandService implementa el caso de uso del issue #292: leer y actualizar la
// marca y el vocabulario del negocio activo. Vive en shops porque shops es
// el dueño de la configuración del negocio, pero no comparte Service
// (HU-020) para no ampliar su contrato cerrado de cuatro campos.
type BrandService struct {
	repo     BrandRepository
	geocoder Geocoder
}

// NewBrandService construye el servicio. geocoder puede ser nil: sin él, guardar
// una dirección nueva responde que la verificación no está disponible, pero
// todo lo demás de la marca sigue funcionando.
func NewBrandService(repo BrandRepository, geocoder Geocoder) *BrandService {
	return &BrandService{repo: repo, geocoder: geocoder}
}

// Get lee la marca del negocio businessID. businessID llega siempre de
// un auth.Principal ya autenticado; este método no acepta ningún
// identificador que el cliente pueda controlar.
func (s *BrandService) Get(ctx context.Context, businessID string) (Brand, error) {
	if err := ctx.Err(); err != nil {
		return Brand{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de leer la marca: %w", err))
	}

	brand, found, err := s.repo.Get(ctx, businessID)
	if err != nil {
		return Brand{}, apperr.Internal(fmt.Errorf("shops: leer marca: %w", err))
	}
	if !found {
		return Brand{}, apperr.NotFound("negocio no encontrado")
	}
	return brand, nil
}

// Update normaliza y valida input y, si pasa todas las comprobaciones de
// campo, delega en el repositorio la escritura. Los campos se evalúan en el
// orden fijo del contrato; el primer error es el que se devuelve, sin
// ejecutar ninguna escritura (mismo criterio que Service.Update).
//
// location es opcional (DEC-130): un parche vacío no toca la ubicación. Una
// dirección nueva se geocodifica ANTES de escribir y fuera de la transacción;
// si no se resuelve se rechaza con 422 y el valor anterior queda intacto
// (CA-102-01). Reenviar la dirección ya guardada no vuelve a consultar al
// proveedor ni cambia las coordenadas.
func (s *BrandService) Update(ctx context.Context, businessID string, input Brand, location LocationPatch) (Brand, error) {
	if err := ctx.Err(); err != nil {
		return Brand{}, apperr.Internal(fmt.Errorf("shops: contexto cancelado antes de actualizar la marca: %w", err))
	}

	if !IsAllowedAccent(input.Accent) {
		return Brand{}, errBrandAccentInvalid()
	}

	brand := Brand{
		Accent:                 input.Accent,
		BusinessTerm:           NormalizeTerm(input.BusinessTerm),
		BusinessTermGender:     input.BusinessTermGender,
		ProfessionalTerm:       NormalizeTerm(input.ProfessionalTerm),
		ProfessionalTermPlural: NormalizeTerm(input.ProfessionalTermPlural),
		ProfessionalTermGender: input.ProfessionalTermGender,
	}

	switch {
	case !IsValidTerm(brand.BusinessTerm):
		return Brand{}, errBrandTermInvalid("businessTerm")
	case !brand.BusinessTermGender.IsValid():
		return Brand{}, errBrandGenderInvalid("businessTermGender")
	case !IsValidTerm(brand.ProfessionalTerm):
		return Brand{}, errBrandTermInvalid("professionalTerm")
	case !IsValidTerm(brand.ProfessionalTermPlural):
		return Brand{}, errBrandTermInvalid("professionalTermPlural")
	case !brand.ProfessionalTermGender.IsValid():
		return Brand{}, errBrandGenderInvalid("professionalTermGender")
	}

	write, err := s.resolveLocation(ctx, businessID, location)
	if err != nil {
		return Brand{}, err
	}

	result, err := s.repo.Update(ctx, businessID, brand, write)
	if err != nil {
		return Brand{}, apperr.Internal(fmt.Errorf("shops: actualizar marca: %w", err))
	}
	if !result.Found {
		return Brand{}, apperr.NotFound("negocio no encontrado")
	}
	return result.Brand, nil
}

// resolveLocation convierte el parche pedido en los cambios que se escriben:
// normaliza la dirección, decide si hace falta geocodificar y lo hace. No
// escribe nada.
func (s *BrandService) resolveLocation(ctx context.Context, businessID string, patch LocationPatch) (LocationWrite, error) {
	write := LocationWrite{HasPhysicalLocation: patch.HasPhysicalLocation, OffersHomeService: patch.OffersHomeService}
	pin, err := manualPin(patch)
	if err != nil {
		return LocationWrite{}, err
	}
	if !patch.AddressSet {
		if pin != nil {
			return LocationWrite{}, errPinWithoutAddress()
		}
		return write, nil
	}

	var address *string
	if patch.Address != nil {
		address = NormalizeAddress(*patch.Address)
	}
	write.ReplaceAddress = true
	if address == nil {
		if pin != nil {
			return LocationWrite{}, errPinWithoutAddress()
		}
		// Quitar la dirección quita también sus coordenadas.
		return write, nil
	}
	if !IsValidAddressLength(*address) {
		return LocationWrite{}, errAddressTooLong()
	}
	if pin != nil {
		// Punto elegido a mano (DEC-170): manda sobre la geocodificación, que
		// no se consulta. La dirección escrita lo acompaña como texto.
		write.Address = address
		write.Latitude = &pin.Latitude
		write.Longitude = &pin.Longitude
		return write, nil
	}

	current, found, err := s.repo.Get(ctx, businessID)
	if err != nil {
		return LocationWrite{}, apperr.Internal(fmt.Errorf("shops: leer ubicación vigente: %w", err))
	}
	if !found {
		return LocationWrite{}, apperr.NotFound("negocio no encontrado")
	}
	cur := current.Location
	if cur.Address != nil && *cur.Address == *address && cur.Latitude != nil && cur.Longitude != nil {
		// Misma dirección y ya geocodificada: no se gasta otra consulta ni se
		// mueve el marcador.
		write.Address, write.Latitude, write.Longitude = cur.Address, cur.Latitude, cur.Longitude
		return write, nil
	}

	if s.geocoder == nil {
		return LocationWrite{}, errGeocoderUnavailable()
	}
	point, err := s.geocoder.Geocode(ctx, *address)
	switch {
	case err == nil:
	case errors.Is(err, ErrAddressUnresolvable):
		return LocationWrite{}, errAddressUnresolvable()
	case errors.Is(err, ErrGeocoderUnavailable):
		return LocationWrite{}, errGeocoderUnavailable()
	default:
		return LocationWrite{}, apperr.Internal(fmt.Errorf("shops: geocodificar dirección: %w", err))
	}
	write.Address = address
	write.Latitude = &point.Latitude
	write.Longitude = &point.Longitude
	return write, nil
}

// manualPin valida el punto elegido a mano (DEC-170): nil si no vino, o el
// punto si vino completo y dentro de rango. NaN o infinito no pasan el rango.
func manualPin(patch LocationPatch) (*Coordinates, error) {
	if patch.Latitude == nil && patch.Longitude == nil {
		return nil, nil
	}
	if patch.Latitude == nil || patch.Longitude == nil {
		return nil, errPinIncomplete()
	}
	lat, lng := *patch.Latitude, *patch.Longitude
	if !(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180) {
		return nil, errPinOutOfRange()
	}
	return &Coordinates{Latitude: lat, Longitude: lng}, nil
}
