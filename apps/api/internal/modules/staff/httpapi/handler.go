// Package httpapi es el adaptador HTTP del módulo staff: decodifica,
// invoca staff.Service y traduce el resultado a HTTP
// (nava-docs/agenda/03-desarrollo/estandar-backend-go.md §4). No importa Chi
// directamente: usa httpserver.URLParam para leer {professionalId}, igual que
// httpserver.RequestIDFromContext/IdempotencyKeyFromRequest para el resto
// de valores que Chi o net/http exponen (DEC-034,
// internal/platform/archtest/chi_boundary_test.go).
package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"nava-agenda/internal/modules/access"
	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
	"nava-agenda/internal/platform/idempotency"
)

// professionalIDParam es el nombre del parámetro de ruta que cmd/api.buildRouter
// registra para /private/professionals/{professionalId}.
const professionalIDParam = "professionalId"

// professionalBasePath es la base usada para construir el header Location de un
// alta exitosa, relativa a /api/v1 (igual que el resto del contrato).
const professionalBasePath = "/private/professionals/"

func principalOrInternalError(w http.ResponseWriter, r *http.Request, requestID string) (auth.Principal, bool) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		// Mismo defecto de wiring que shops/httpapi contempla: solo puede
		// ocurrir si esta ruta se montó fuera del subrouter protegido por
		// SessionMiddleware (CA-006-04 lo evita estructuralmente).
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("staff: falta el principal de sesión en el contexto")), requestID))
		return auth.Principal{}, false
	}
	return principal, true
}

func writeUnknownFieldOrInvalidJSONProblem(w http.ResponseWriter, requestID string) {
	httpserver.WriteProblem(w, httpserver.Translate(
		apperr.Invalid("cuerpo JSON inválido o con un campo desconocido"), requestID))
}

// ListProfessionalsHandler expone GET /private/professionals (CA-021-01, CA-021-02).
type ListProfessionalsHandler struct {
	service *staff.Service
}

// NewListProfessionalsHandler construye el handler de listado.
func NewListProfessionalsHandler(service *staff.Service) *ListProfessionalsHandler {
	return &ListProfessionalsHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *ListProfessionalsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}
	// DEC-173: el empleado solo ve su propio profesional (o ninguno sin vínculo).
	if scope := access.ScopeFromContext(r.Context()); scope.Restricted {
		h.serveOwnOnly(w, r, principal.BusinessID, scope.ProfessionalID, requestID)
		return
	}

	query := r.URL.Query()
	if query.Has("page") || query.Has("pageSize") {
		if query.Has("cursor") || query.Has("limit") {
			httpserver.WriteProblem(w, httpserver.Translate(apperr.Invalid("no se pueden combinar los modos de paginación"), requestID))
			return
		}
		page, size := 1, staff.DefaultListLimit
		for _, parameter := range []struct {
			name   string
			target *int
		}{{"page", &page}, {"pageSize", &size}} {
			if query.Has(parameter.name) {
				value, err := strconv.Atoi(query.Get(parameter.name))
				if err != nil || value < 1 || (parameter.name == "pageSize" && value > staff.MaxListLimit) {
					httpserver.WriteProblem(w, httpserver.Translate(apperr.Invalid("parámetro de paginación inválido"), requestID))
					return
				}
				*parameter.target = value
			}
		}
		result, err := h.service.ListPage(r.Context(), principal.BusinessID, page, size)
		if err != nil {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		response := newProfessionalListResponse(staff.ListResult{Items: result.Items})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			ProfessionalListResponse
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			Total      int `json:"total"`
			TotalPages int `json:"totalPages"`
		}{response, result.Page, result.PageSize, result.Total, result.TotalPages})
		return
	}
	cursor := query.Get("cursor")

	limit := 0
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			httpserver.WriteProblem(w, httpserver.Translate(
				apperr.Invalid("el parámetro limit debe ser un entero positivo"), requestID))
			return
		}
		limit = parsed
	}

	result, err := h.service.List(r.Context(), principal.BusinessID, cursor, limit)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newProfessionalListResponse(result))
}

// serveOwnOnly responde la lista del empleado restringido: su profesional
// vinculado o ninguno, en el mismo modo de paginación que se pidió.
func (h *ListProfessionalsHandler) serveOwnOnly(w http.ResponseWriter, r *http.Request, businessID, professionalID, requestID string) {
	items := []staff.Professional{}
	if professionalID != "" {
		professional, err := h.service.Get(r.Context(), businessID, professionalID)
		if err != nil {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		items = append(items, professional)
	}
	response := newProfessionalListResponse(staff.ListResult{Items: items})
	w.Header().Set("Content-Type", "application/json")
	query := r.URL.Query()
	if query.Has("page") || query.Has("pageSize") {
		pageSize := staff.DefaultListLimit
		if value, err := strconv.Atoi(query.Get("pageSize")); err == nil && value >= 1 && value <= staff.MaxListLimit {
			pageSize = value
		}
		// Siempre una página, como GREATEST(1, …) del repositorio.
		totalPages := 1
		_ = json.NewEncoder(w).Encode(struct {
			ProfessionalListResponse
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			Total      int `json:"total"`
			TotalPages int `json:"totalPages"`
		}{response, 1, pageSize, len(items), totalPages})
		return
	}
	_ = json.NewEncoder(w).Encode(response)
}

// GetProfessionalHandler expone GET /private/professionals/{professionalId} (CA-021-05: la
// lectura individual permite demostrar de forma directa el 404 de un
// profesional de otro negocio).
type GetProfessionalHandler struct {
	service *staff.Service
}

// NewGetProfessionalHandler construye el handler de lectura individual.
func NewGetProfessionalHandler(service *staff.Service) *GetProfessionalHandler {
	return &GetProfessionalHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *GetProfessionalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	professionalID := httpserver.URLParam(r, professionalIDParam)
	professional, err := h.service.Get(r.Context(), principal.BusinessID, professionalID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newProfessionalResponse(professional))
}

// CreateProfessionalHandler expone POST /private/professionals (CA-021-02), protegido
// por el protocolo de idempotencia reutilizable de HU-004 (RN-IDE-01,
// DEC-043).
type CreateProfessionalHandler struct {
	service *staff.Service
}

// NewCreateProfessionalHandler construye el handler de alta.
func NewCreateProfessionalHandler(service *staff.Service) *CreateProfessionalHandler {
	return &CreateProfessionalHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *CreateProfessionalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	// 1. Cabecera: obligatoria, validada antes de tocar PostgreSQL o leer
	//    el cuerpo (nava-docs/agenda/apps/api/README.md, "Patrón obligatorio: idempotencia
	//    reutilizable").
	key, err := httpserver.IdempotencyKeyFromRequest(r)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	// 2. Cuerpo CRUDO, leído una sola vez: la huella de idempotencia debe
	//    calcularse sobre los bytes exactos recibidos, nunca sobre una
	//    re-serialización del JSON ya decodificado.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		httpserver.WriteProblem(w, httpserver.Translate(apperr.Invalid("cuerpo de la solicitud ilegible"), requestID))
		return
	}

	var req CreateProfessionalRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}
	if dec.More() {
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}

	fingerprint := httpserver.IdempotencyFingerprint(r, body)

	result, err := h.service.Create(r.Context(), principal.BusinessID, req.FullName, req.Description, key, fingerprint)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	switch result.Decision.Outcome {
	case idempotency.OutcomeProceed, idempotency.OutcomeReplay:
		// El mismo result.Response, byte a byte, para la primera ejecución
		// y para cualquier repetición exacta (CA-004-01). Location se
		// reconstruye a partir del `id` del cuerpo ya persistido: funciona
		// igual para ambos desenlaces, sin necesitar un campo aparte.
		var parsed struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal([]byte(result.Response.Body), &parsed)
		w.Header().Set("Location", professionalBasePath+parsed.ID)
		httpserver.WriteStoredResponse(w, result.Response)
	default:
		// Conflicto de contenido/operación (RN-IDE-01) o ejecución en curso
		// (DEC-043): Translate ya sabe convertirlo en 409.
		httpserver.WriteProblem(w, httpserver.Translate(result.Decision.AsError(), requestID))
	}
}

// UpdateProfessionalHandler expone PATCH /private/professionals/{professionalId} (CA-021-04).
type UpdateProfessionalHandler struct {
	service *staff.Service
}

// NewUpdateProfessionalHandler construye el handler de actualización.
func NewUpdateProfessionalHandler(service *staff.Service) *UpdateProfessionalHandler {
	return &UpdateProfessionalHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *UpdateProfessionalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	professionalID := httpserver.URLParam(r, professionalIDParam)

	var req UpdateProfessionalRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}
	if dec.More() {
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}

	professional, err := h.service.Update(
		r.Context(), principal.BusinessID, professionalID, req.FullName,
		staff.DescriptionPatch{Set: req.Description.Set, Value: req.Description.Value},
	)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newProfessionalResponse(professional))
}

func newProfessionalResponse(b staff.Professional) ProfessionalResponse {
	return ProfessionalResponse{
		ID:             b.ID,
		FullName:       b.FullName,
		CreatedAt:      b.CreatedAt,
		UpdatedAt:      b.UpdatedAt,
		PhotoUpdatedAt: b.PhotoUpdatedAt,
		Description:    b.Description,
		Rating:         b.Rating,
		RatingCount:    b.RatingCount,
	}
}

func newProfessionalListResponse(result staff.ListResult) ProfessionalListResponse {
	items := make([]ProfessionalResponse, 0, len(result.Items))
	for _, b := range result.Items {
		items = append(items, newProfessionalResponse(b))
	}
	var next *string
	if result.NextCursor != "" {
		v := result.NextCursor
		next = &v
	}
	return ProfessionalListResponse{Items: items, NextCursor: next}
}

// PutProfessionalPhotoHandler expone PUT /private/professionals/{professionalId}/photo (DEC-104):
// reemplaza la fotografía del profesional con el cuerpo binario de la solicitud.
// PUT es idempotente por naturaleza (repetir el mismo cuerpo deja el mismo
// estado), así que no lleva Idempotency-Key.
type PutProfessionalPhotoHandler struct {
	service *staff.Service
}

// NewPutProfessionalPhotoHandler construye el handler de subida de fotografía.
func NewPutProfessionalPhotoHandler(service *staff.Service) *PutProfessionalPhotoHandler {
	return &PutProfessionalPhotoHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *PutProfessionalPhotoHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	// La cabecera solo declara la intención: el servicio decide el formato por
	// los bytes y exige que coincidan (staff.ValidatePhoto). Un tipo ausente o
	// distinto de JPEG/PNG se rechaza antes de leer el cuerpo.
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || (mediaType != staff.PhotoContentTypeJPEG && mediaType != staff.PhotoContentTypePNG) {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Validation("la fotografía debe enviarse como image/jpeg o image/png"), requestID))
		return
	}

	// httpserver.BodyLimit ya acota el cuerpo a 1 MiB; el servicio aplica el
	// tope propio de la fotografía (512 KiB) con su mensaje específico.
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		httpserver.WriteProblem(w, httpserver.Translate(apperr.Invalid("cuerpo de la solicitud ilegible"), requestID))
		return
	}

	professional, err := h.service.SetPhoto(r.Context(), principal.BusinessID,
		httpserver.URLParam(r, professionalIDParam), mediaType, data)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newProfessionalResponse(professional))
}

// GetProfessionalPhotoHandler expone GET /private/professionals/{professionalId}/photo (DEC-104):
// sirve los bytes de la fotografía con validador ETag para que el navegador
// revalide barato. El cliente versiona la URL con `photoUpdatedAt`, así que una
// fotografía nueva nunca se sirve desde una caché vieja.
type GetProfessionalPhotoHandler struct {
	service *staff.Service
}

// NewGetProfessionalPhotoHandler construye el handler de lectura de fotografía.
func NewGetProfessionalPhotoHandler(service *staff.Service) *GetProfessionalPhotoHandler {
	return &GetProfessionalPhotoHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *GetProfessionalPhotoHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	photo, err := h.service.Photo(r.Context(), principal.BusinessID, httpserver.URLParam(r, professionalIDParam))
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	etag := `"` + strconv.FormatInt(photo.UpdatedAt.UnixMicro(), 10) + `"`
	header := w.Header()
	header.Set("ETag", etag)
	// private: es un retrato de una persona, nunca cacheable por un
	// intermediario compartido.
	header.Set("Cache-Control", "private, max-age=3600")

	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	header.Set("Content-Type", photo.ContentType)
	header.Set("Content-Length", strconv.Itoa(len(photo.Data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(photo.Data)
}

// DeleteProfessionalPhotoHandler expone DELETE /private/professionals/{professionalId}/photo
// (DEC-104): quita la fotografía; el profesional vuelve al monograma. Idempotente:
// quitar una fotografía inexistente también responde 204.
type DeleteProfessionalPhotoHandler struct {
	service *staff.Service
}

// NewDeleteProfessionalPhotoHandler construye el handler de borrado de fotografía.
func NewDeleteProfessionalPhotoHandler(service *staff.Service) *DeleteProfessionalPhotoHandler {
	return &DeleteProfessionalPhotoHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *DeleteProfessionalPhotoHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	if err := h.service.RemovePhoto(r.Context(), principal.BusinessID, httpserver.URLParam(r, professionalIDParam)); err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
