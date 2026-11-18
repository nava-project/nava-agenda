package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
)

// PublicLinkResponse es la representación de GET /private/settings/public-link
// (issue #304, DEC-117): solo el slug, sin ningún identificador interno.
type PublicLinkResponse struct {
	Slug string `json:"slug"`
}

// GetPublicLinkHandler expone GET /private/settings/public-link: lectura
// autenticada del enlace público del negocio de la sesión, generado en la
// primera lectura si aún no existe.
type GetPublicLinkHandler struct {
	service *shops.PublicLinkService
}

// NewGetPublicLinkHandler construye el handler.
func NewGetPublicLinkHandler(service *shops.PublicLinkService) *GetPublicLinkHandler {
	return &GetPublicLinkHandler{service: service}
}

// ServeHTTP implementa http.Handler. El negocio sale exclusivamente de
// auth.Principal: la ruta no recibe parámetros ni cuerpo.
func (h *GetPublicLinkHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return
	}

	link, err := h.service.Get(r.Context(), principal.BusinessID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(PublicLinkResponse{Slug: link.Slug})
}
