// Package postgres es el adaptador de persistencia de reviews.Repository sobre
// database.DB. Las lecturas públicas resuelven el tenant sin sesión con las
// funciones SECURITY DEFINER estrechas ya existentes (slug y token) y leen bajo
// RLS dentro de InTenantTx, igual que publicbooking y customeraccess.
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nava-agenda/internal/modules/reviews"
	"nava-agenda/internal/platform/database"
)

// Repository implementa reviews.Repository.
type Repository struct {
	db *database.DB
}

// New construye el repositorio.
func New(db *database.DB) *Repository { return &Repository{db: db} }

var _ reviews.Repository = (*Repository)(nil)

// CreateByTokenHash resuelve el tenant del token (sin RLS, misma función que
// customeraccess) y, ya dentro de su transacción, inserta la reseña con una sola
// sentencia INSERT … SELECT que exige token vigente, turno `completed` y, por
// ON CONFLICT, ninguna reseña previa. Sin fila devuelta no se distingue la causa
// (CA-100-01). El disparador de la tabla repite la regla contra SQL directo.
func (r *Repository) CreateByTokenHash(ctx context.Context, tokenHash string, rating int, comment *string) (reviews.Review, reviews.CreateOutcome, error) {
	businessID, found, err := r.db.ResolveTenant(ctx, `SELECT public_resolve_appointment_token_tenant($1)`, tokenHash)
	if err != nil {
		return reviews.Review{}, reviews.TokenNotFound, fmt.Errorf("reviews/postgres: resolve tenant by token: %w", err)
	}
	if !found {
		return reviews.Review{}, reviews.TokenNotFound, nil
	}

	var review reviews.Review
	created := false
	err = r.db.InTenantTx(ctx, businessID, func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`INSERT INTO professional_review (business_id, professional_id, appointment_id, rating, comment)
			 SELECT t.business_id, ap.professional_id, ap.id, $2, $3
			   FROM appointment_access_token t
			   JOIN appointment ap ON ap.business_id = t.business_id AND ap.id = t.appointment_id
			  WHERE t.token_hash = $1
			    AND t.revoked_at IS NULL
			    AND (t.expires_at IS NULL OR t.expires_at > now())
			    AND ap.status = 'completed'
			 ON CONFLICT (appointment_id) DO NOTHING
			 RETURNING id, professional_id, rating, comment, hidden_at, created_at`,
			tokenHash, rating, comment,
		).Scan(&review.ID, &review.ProfessionalID, &review.Rating, &review.Comment, &review.HiddenAt, &review.CreatedAt)
		switch {
		case err == nil:
			created = true
		case errors.Is(err, pgx.ErrNoRows):
			// Turno no completado o ya reseñado: no se distingue.
		default:
			return fmt.Errorf("insert professional_review: %w", err)
		}
		return nil
	})
	if err != nil {
		return reviews.Review{}, reviews.TokenNotFound, fmt.Errorf("reviews/postgres: create: %w", err)
	}
	if !created {
		return reviews.Review{}, reviews.NotAvailable, nil
	}
	return review, reviews.Created, nil
}

const summarySQL = `SELECT round(avg(rating)::numeric, 1)::float8, count(*)
	   FROM professional_review
	  WHERE business_id = $1 AND professional_id = $2 AND hidden_at IS NULL`

func scanSummary(ctx context.Context, q database.Queries, businessID, professionalID string) (reviews.Summary, error) {
	var s reviews.Summary
	if err := q.QueryRow(ctx, summarySQL, businessID, professionalID).Scan(&s.Rating, &s.RatingCount); err != nil {
		return reviews.Summary{}, fmt.Errorf("summary: %w", err)
	}
	return s, nil
}

func professionalExists(ctx context.Context, q database.Queries, businessID, professionalID string) (bool, error) {
	var one int
	err := q.QueryRow(ctx, `SELECT 1 FROM professional WHERE business_id = $1 AND id = $2`, businessID, professionalID).Scan(&one)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, pgx.ErrNoRows):
		return false, nil
	default:
		return false, fmt.Errorf("professional exists: %w", err)
	}
}

// ListPublic implementa reviews.Repository.
func (r *Repository) ListPublic(ctx context.Context, slug, professionalID string, limit int) (reviews.PublicList, bool, error) {
	businessID, found, err := r.db.ResolveTenant(ctx, `SELECT public_resolve_business_by_slug($1)`, slug)
	if err != nil {
		return reviews.PublicList{}, false, fmt.Errorf("reviews/postgres: resolve tenant by slug: %w", err)
	}
	if !found {
		return reviews.PublicList{}, false, nil
	}

	var list reviews.PublicList
	exists := false
	err = r.db.InTenantTx(ctx, businessID, func(ctx context.Context, q database.Queries) error {
		ok, err := professionalExists(ctx, q, string(businessID), professionalID)
		if err != nil || !ok {
			return err
		}
		exists = true
		if list.Summary, err = scanSummary(ctx, q, string(businessID), professionalID); err != nil {
			return err
		}
		rows, err := q.Query(ctx,
			`SELECT rating, comment, created_at
			   FROM professional_review
			  WHERE business_id = $1 AND professional_id = $2 AND hidden_at IS NULL
			  ORDER BY created_at DESC, id
			  LIMIT $3`,
			string(businessID), professionalID, limit)
		if err != nil {
			return fmt.Errorf("list public reviews: %w", err)
		}
		defer rows.Close()
		list.Items = make([]reviews.PublicReview, 0)
		for rows.Next() {
			var item reviews.PublicReview
			if err := rows.Scan(&item.Rating, &item.Comment, &item.CreatedAt); err != nil {
				return fmt.Errorf("list public reviews: scan: %w", err)
			}
			list.Items = append(list.Items, item)
		}
		return rows.Err()
	})
	if err != nil {
		return reviews.PublicList{}, false, fmt.Errorf("reviews/postgres: list public: %w", err)
	}
	return list, exists, nil
}

// ListForProfessional implementa reviews.Repository.
func (r *Repository) ListForProfessional(ctx context.Context, businessID, professionalID string, limit int) (reviews.PanelList, bool, error) {
	var list reviews.PanelList
	exists := false
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		ok, err := professionalExists(ctx, q, businessID, professionalID)
		if err != nil || !ok {
			return err
		}
		exists = true
		if list.Summary, err = scanSummary(ctx, q, businessID, professionalID); err != nil {
			return err
		}
		rows, err := q.Query(ctx,
			`SELECT id, professional_id, rating, comment, hidden_at, created_at
			   FROM professional_review
			  WHERE business_id = $1 AND professional_id = $2
			  ORDER BY created_at DESC, id
			  LIMIT $3`,
			businessID, professionalID, limit)
		if err != nil {
			return fmt.Errorf("list panel reviews: %w", err)
		}
		defer rows.Close()
		list.Items = make([]reviews.Review, 0)
		for rows.Next() {
			var item reviews.Review
			if err := rows.Scan(&item.ID, &item.ProfessionalID, &item.Rating, &item.Comment, &item.HiddenAt, &item.CreatedAt); err != nil {
				return fmt.Errorf("list panel reviews: scan: %w", err)
			}
			list.Items = append(list.Items, item)
		}
		return rows.Err()
	})
	if err != nil {
		return reviews.PanelList{}, false, fmt.Errorf("reviews/postgres: list for professional: %w", err)
	}
	return list, exists, nil
}

// SetHidden implementa reviews.Repository.
func (r *Repository) SetHidden(ctx context.Context, businessID, professionalID, reviewID string, hidden bool) (reviews.Review, bool, error) {
	var review reviews.Review
	found := false
	err := r.db.InTenantTx(ctx, database.BusinessID(businessID), func(ctx context.Context, q database.Queries) error {
		err := q.QueryRow(ctx,
			`UPDATE professional_review
			    SET hidden_at = CASE WHEN $4::boolean THEN COALESCE(hidden_at, now()) ELSE NULL END
			  WHERE business_id = $1 AND professional_id = $2 AND id = $3
			  RETURNING id, professional_id, rating, comment, hidden_at, created_at`,
			businessID, professionalID, reviewID, hidden,
		).Scan(&review.ID, &review.ProfessionalID, &review.Rating, &review.Comment, &review.HiddenAt, &review.CreatedAt)
		switch {
		case err == nil:
			found = true
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return fmt.Errorf("update professional_review: %w", err)
		}
		return nil
	})
	if err != nil {
		return reviews.Review{}, false, fmt.Errorf("reviews/postgres: set hidden: %w", err)
	}
	return review, found, nil
}
