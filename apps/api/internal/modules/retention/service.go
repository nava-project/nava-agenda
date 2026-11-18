package retention

import (
	"context"
	"fmt"
)

const (
	// BatchLimit es el máximo de clientes por lote que acepta
	// customer_anonymize_expired (p_limit 1-200).
	BatchLimit = 200

	// maxBatchesPerRun acota una pasada a 10 000 clientes: un atraso grande
	// no monopoliza el worker y lo que quede sigue en la pasada siguiente.
	maxBatchesPerRun = 50
)

// Store anonimiza en una transacción hasta limit clientes vencidos y devuelve
// cuántos anonimizó.
type Store interface {
	AnonymizeExpired(ctx context.Context, limit int) (int, error)
}

// Service corre los lotes de anonimización de una pasada.
type Service struct {
	store      Store
	limit      int
	maxBatches int
}

// NewService construye el servicio con el lote máximo de la base.
func NewService(store Store) *Service {
	return &Service{store: store, limit: BatchLimit, maxBatches: maxBatchesPerRun}
}

// RunOnce repite lotes mientras vengan llenos y devuelve cuántos clientes
// anonimizó en total. Un lote incompleto significa que no quedan vencidos (o
// que otro worker tomó los restantes con SKIP LOCKED). Ante un error devuelve
// lo ya anonimizado: cada lote confirmado es definitivo.
func (s *Service) RunOnce(ctx context.Context) (int, error) {
	total := 0
	for range s.maxBatches {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := s.store.AnonymizeExpired(ctx, s.limit)
		if err != nil {
			return total, fmt.Errorf("retention: anonymize expired customers: %w", err)
		}
		total += n
		if n < s.limit {
			return total, nil
		}
	}
	return total, nil
}
