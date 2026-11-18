package postgres_test

import (
	"bytes"
	"context"
	"testing"

	"nava-agenda/internal/modules/staff"
)

// Pruebas de integración de la fotografía (DEC-104) contra PostgreSQL real y
// DOS negocios (shopC/shopD): RLS y la FK compuesta por tenant son lo que
// aísla las imágenes, así que nada de esto se prueba con dobles.

func photoBytes(marker byte) staff.Photo {
	// El repositorio persiste lo que el servicio ya validó: no decodifica, así
	// que basta un cuerpo distinguible por byte para comparar identidad.
	return staff.Photo{ContentType: staff.PhotoContentTypeJPEG, Data: bytes.Repeat([]byte{marker}, 2048)}
}

func TestPutPhoto_CreatesThenReplacesWithoutDuplicating(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	professional := createProfessional(t, repo, shopC, "Con foto "+uniqueSuffix(t))
	ctx := context.Background()

	if professional.PhotoUpdatedAt != nil {
		t.Fatalf("a new professional has no photo, got %v", professional.PhotoUpdatedAt)
	}

	first, err := repo.PutPhoto(ctx, string(shopC), professional.ID, photoBytes(1))
	if err != nil || !first.Found {
		t.Fatalf("PutPhoto: found=%v err=%v", first.Found, err)
	}
	if first.Professional.PhotoUpdatedAt == nil {
		t.Fatal("the returned professional must carry photoUpdatedAt")
	}
	if first.Professional.FullName != professional.FullName {
		t.Fatalf("uploading a photo must not touch the name, got %q", first.Professional.FullName)
	}

	second, err := repo.PutPhoto(ctx, string(shopC), professional.ID, staff.Photo{ContentType: staff.PhotoContentTypePNG, Data: photoBytes(2).Data})
	if err != nil || !second.Found {
		t.Fatalf("PutPhoto (replace): found=%v err=%v", second.Found, err)
	}
	if !second.Professional.PhotoUpdatedAt.After(*first.Professional.PhotoUpdatedAt) {
		t.Fatalf("replacing must advance the version: %v then %v", first.Professional.PhotoUpdatedAt, second.Professional.PhotoUpdatedAt)
	}

	stored, found, err := repo.GetPhoto(ctx, string(shopC), professional.ID)
	if err != nil || !found {
		t.Fatalf("GetPhoto: found=%v err=%v", found, err)
	}
	if stored.ContentType != staff.PhotoContentTypePNG || !bytes.Equal(stored.Data, photoBytes(2).Data) {
		t.Fatal("GetPhoto must return the replacement, not the first upload")
	}
	if !stored.UpdatedAt.Equal(*second.Professional.PhotoUpdatedAt) {
		t.Fatalf("GetPhoto and the professional must agree on the version: %v vs %v", stored.UpdatedAt, second.Professional.PhotoUpdatedAt)
	}
}

func TestPutPhoto_ListAndGetExposePhotoUpdatedAtWithoutTheBytes(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	withPhoto := createProfessional(t, repo, shopC, "Lista con foto "+uniqueSuffix(t))
	without := createProfessional(t, repo, shopC, "Lista sin foto "+uniqueSuffix(t))
	ctx := context.Background()

	put, err := repo.PutPhoto(ctx, string(shopC), withPhoto.ID, photoBytes(3))
	if err != nil || !put.Found {
		t.Fatalf("PutPhoto: found=%v err=%v", put.Found, err)
	}

	got, found, err := repo.Get(ctx, string(shopC), withPhoto.ID)
	if err != nil || !found || got.PhotoUpdatedAt == nil {
		t.Fatalf("Get must expose photoUpdatedAt: found=%v err=%v photo=%v", found, err, got.PhotoUpdatedAt)
	}

	seenWith, seenWithout := false, false
	var cursor *staff.Cursor
	for {
		page, err := repo.List(ctx, string(shopC), cursor, 50)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		for _, item := range page.Items {
			switch item.ID {
			case withPhoto.ID:
				seenWith = item.PhotoUpdatedAt != nil
			case without.ID:
				seenWithout = item.PhotoUpdatedAt == nil
			}
		}
		if page.NextCursor == "" {
			break
		}
		decoded, err := staff.DecodeCursor(page.NextCursor)
		if err != nil {
			t.Fatalf("DecodeCursor: %v", err)
		}
		cursor = &decoded
	}
	if !seenWith || !seenWithout {
		t.Fatalf("List must mark who has a photo: withPhoto=%v withoutPhoto=%v", seenWith, seenWithout)
	}

	renamed, err := repo.Update(ctx, string(shopC), withPhoto.ID, "Renombrado "+uniqueSuffix(t), staff.DescriptionPatch{})
	if err != nil || !renamed.Found || renamed.Professional.PhotoUpdatedAt == nil {
		t.Fatalf("Rename must keep reporting the photo: found=%v err=%v photo=%v", renamed.Found, err, renamed.Professional.PhotoUpdatedAt)
	}
}

func TestPhoto_CrossTenant_NeverWritesReadsOrDeletesAnotherShopsPhoto(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	ctx := context.Background()
	professionalInC := createProfessional(t, repo, shopC, "Solo de C "+uniqueSuffix(t))

	if _, err := repo.PutPhoto(ctx, string(shopC), professionalInC.ID, photoBytes(4)); err != nil {
		t.Fatalf("PutPhoto in own tenant: %v", err)
	}

	// Escribir: con el contexto de D y el id de un profesional de C no hay fila.
	put, err := repo.PutPhoto(ctx, string(shopD), professionalInC.ID, photoBytes(9))
	if err != nil {
		t.Fatalf("PutPhoto cross-tenant must not error, got %v", err)
	}
	if put.Found {
		t.Fatal("RN-TEN-01: another shop must not be able to put a photo on this professional")
	}

	// Leer: mismo "no existe" que una fotografía inexistente.
	if _, found, err := repo.GetPhoto(ctx, string(shopD), professionalInC.ID); err != nil || found {
		t.Fatalf("RN-TEN-01: cross-tenant GetPhoto must find nothing (found=%v err=%v)", found, err)
	}

	// Borrar: no existe para D, y la fotografía de C sigue intacta.
	if found, err := repo.DeletePhoto(ctx, string(shopD), professionalInC.ID); err != nil || found {
		t.Fatalf("RN-TEN-01: cross-tenant DeletePhoto must report not found (found=%v err=%v)", found, err)
	}
	stored, found, err := repo.GetPhoto(ctx, string(shopC), professionalInC.ID)
	if err != nil || !found || !bytes.Equal(stored.Data, photoBytes(4).Data) {
		t.Fatalf("the owner's photo must be untouched (found=%v err=%v)", found, err)
	}
}

func TestDeletePhoto_RemovesTheRowAndIsIdempotent(t *testing.T) {
	db := setupTestDB(t)
	repo := newRepository(db)
	ctx := context.Background()
	professional := createProfessional(t, repo, shopC, "Quitar foto "+uniqueSuffix(t))

	// Sin fotografía todavía: el profesional existe, así que es un éxito.
	if found, err := repo.DeletePhoto(ctx, string(shopC), professional.ID); err != nil || !found {
		t.Fatalf("deleting a missing photo of an existing professional must succeed (found=%v err=%v)", found, err)
	}

	if _, err := repo.PutPhoto(ctx, string(shopC), professional.ID, photoBytes(5)); err != nil {
		t.Fatalf("PutPhoto: %v", err)
	}
	if found, err := repo.DeletePhoto(ctx, string(shopC), professional.ID); err != nil || !found {
		t.Fatalf("DeletePhoto: found=%v err=%v", found, err)
	}
	if _, found, err := repo.GetPhoto(ctx, string(shopC), professional.ID); err != nil || found {
		t.Fatalf("the photo must be gone (found=%v err=%v)", found, err)
	}

	got, ok, err := repo.Get(ctx, string(shopC), professional.ID)
	if err != nil || !ok || got.PhotoUpdatedAt != nil {
		t.Fatalf("the professional must be back to no photo (ok=%v err=%v photo=%v)", ok, err, got.PhotoUpdatedAt)
	}
}

func TestPutPhoto_DatabaseRejectsAnOversizedImageEvenIfTheServiceDidNot(t *testing.T) {
	// Última defensa: professional_photo_image_size_ck. El servicio ya filtra, pero
	// el esquema no debe confiar en que siempre se le llame a través de él.
	db := setupTestDB(t)
	repo := newRepository(db)
	professional := createProfessional(t, repo, shopC, "Enorme "+uniqueSuffix(t))

	tooBig := staff.Photo{ContentType: staff.PhotoContentTypeJPEG, Data: bytes.Repeat([]byte{1}, staff.MaxPhotoBytes+1)}
	if _, err := repo.PutPhoto(context.Background(), string(shopC), professional.ID, tooBig); err == nil {
		t.Fatal("expected the CHECK constraint to reject an image over 512 KiB")
	}
}
