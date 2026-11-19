-- Propósito
--   Issue #660 (DEC-183): Nava Agenda deja de ser solo para barberías. El
--   esquema pasa a hablar de negocio (`business`) y profesional
--   (`professional`) en vez de barbería (`barbershop`) y barbero (`barber`).
--
-- Reglas y decisiones
--   DEC-183, DEC-036 (roll-forward), DEC-070, RN-TEN-01.
--
-- Qué hace
--   1. Renombra tablas, columnas, restricciones, índices, disparadores y
--      políticas: `barbershop` → `business`, `barber` → `professional` y sus
--      derivadas (`barbershop_id` → `business_id`, `barber_id` →
--      `professional_id`, `barber_service` → `professional_service`…). Un
--      renombrado no copia ni reescribe filas: solo cambia el catálogo.
--   2. La variable de sesión del tenant pasa de `app.barbershop_id` a
--      `app.business_id`: se reescriben las políticas RLS que la leen.
--   3. Reescribe las funciones cuyo cuerpo, nombre o parámetros nombran lo
--      renombrado (PL/pgSQL y SQL guardan el texto, no lo siguen). Las que
--      cambian de nombre o de parámetros se borran y se recrean con sus mismos
--      `GRANT EXECUTE`; la dueña es quien migra, como al crearlas.
--   4. Actualiza los comentarios que nombran identificadores renombrados.
--   5. El vocabulario por defecto de un negocio nuevo pasa a «negocio» y
--      «profesional» (DEC-110, DEC-183). Los negocios existentes conservan las
--      palabras que tienen guardadas.
--
-- Qué NO hace
--   Los roles `barberia_*` no se renombran aquí: el rol que migra no puede
--   renombrarse a sí mismo y las migraciones anteriores los nombran. Los
--   renombra el superusuario justo después de esta versión
--   (`database/roles/rename_to_agenda.sql`); ver docs/05-backend/migraciones-atlas.md.
--
-- Clasificación de datos
--   Sin datos nuevos.
--
-- Riesgo y recuperación
--   ALTER … RENAME toma un bloqueo breve por objeto y no reescribe tablas. El
--   API desplegado antes de esta versión deja de funcionar al aplicarse (usa
--   los nombres viejos): el despliegue arranca el API nuevo justo después.
--   Respaldo previo en deploy.sh. Roll-forward (DEC-036).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'barbershop_opening_hour'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261120090000_create_barbershop_opening_hour.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;
END
$$;

-- 1. Tablas, columnas, restricciones, índices, disparadores y políticas
ALTER TABLE barber RENAME TO professional;
ALTER TABLE barber_booking_policy RENAME TO professional_booking_policy;
ALTER TABLE barber_photo RENAME TO professional_photo;
ALTER TABLE barber_review RENAME TO professional_review;
ALTER TABLE barber_service RENAME TO professional_service;
ALTER TABLE barbershop RENAME TO business;
ALTER TABLE barbershop_opening_hour RENAME TO business_opening_hour;
ALTER TABLE appointment RENAME COLUMN barber_id TO professional_id;
ALTER TABLE appointment RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE appointment_access_token RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE appointment_history RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE appointment_history_change RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE appointment_notice RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE appointment_notice_attempt RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE auth_phone_challenge RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE professional RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE professional_booking_policy RENAME COLUMN barber_id TO professional_id;
ALTER TABLE professional_booking_policy RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE professional_photo RENAME COLUMN barber_id TO professional_id;
ALTER TABLE professional_photo RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE professional_review RENAME COLUMN barber_id TO professional_id;
ALTER TABLE professional_review RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE professional_service RENAME COLUMN barber_id TO professional_id;
ALTER TABLE professional_service RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE business_opening_hour RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE customer RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE customer_access_challenge RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE google_calendar_connection RENAME COLUMN barber_id TO professional_id;
ALTER TABLE google_calendar_connection RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE google_calendar_event_link RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE google_calendar_oauth_state RENAME COLUMN barber_id TO professional_id;
ALTER TABLE google_calendar_oauth_state RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE google_calendar_sync_job RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE idempotency_record RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE service RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE staff_credential RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE staff_recovery_code RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE staff_session RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE staff_user RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE staff_user_role RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE time_block RENAME COLUMN barber_id TO professional_id;
ALTER TABLE time_block RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE time_block_series RENAME COLUMN barber_id TO professional_id;
ALTER TABLE time_block_series RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE time_block_series_date RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE time_block_series_exception RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE working_hour RENAME COLUMN barber_id TO professional_id;
ALTER TABLE working_hour RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE working_hour_override RENAME COLUMN barber_id TO professional_id;
ALTER TABLE working_hour_override RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE working_hour_override_segment RENAME COLUMN barbershop_id TO business_id;
ALTER TABLE appointment RENAME CONSTRAINT appointment_barber_interval_excl TO appointment_professional_interval_excl;
ALTER TABLE appointment RENAME CONSTRAINT appointment_barbershop_id_barber_id_fk TO appointment_business_id_professional_id_fk;
ALTER TABLE appointment RENAME CONSTRAINT appointment_barbershop_id_customer_id_fk TO appointment_business_id_customer_id_fk;
ALTER TABLE appointment RENAME CONSTRAINT appointment_barbershop_id_id_uk TO appointment_business_id_id_uk;
ALTER TABLE appointment RENAME CONSTRAINT appointment_barbershop_id_service_id_fk TO appointment_business_id_service_id_fk;
ALTER TABLE appointment_access_token RENAME CONSTRAINT appointment_access_token_barbershop_id_appointment_id_fk TO appointment_access_token_business_id_appointment_id_fk;
ALTER TABLE appointment_history RENAME CONSTRAINT appointment_history_barbershop_id_actor_customer_id_fk TO appointment_history_business_id_actor_customer_id_fk;
ALTER TABLE appointment_history RENAME CONSTRAINT appointment_history_barbershop_id_actor_staff_user_id_fk TO appointment_history_business_id_actor_staff_user_id_fk;
ALTER TABLE appointment_history RENAME CONSTRAINT appointment_history_barbershop_id_appointment_id_fk TO appointment_history_business_id_appointment_id_fk;
ALTER TABLE appointment_history RENAME CONSTRAINT appointment_history_barbershop_id_id_uk TO appointment_history_business_id_id_uk;
ALTER TABLE appointment_history_change RENAME CONSTRAINT appointment_history_change_barbershop_id_history_id_fk TO appointment_history_change_business_id_history_id_fk;
ALTER TABLE appointment_notice RENAME CONSTRAINT appointment_notice_barbershop_id_id_uk TO appointment_notice_business_id_id_uk;
ALTER TABLE auth_phone_challenge RENAME CONSTRAINT auth_phone_challenge_barbershop_id_staff_user_id_fk TO auth_phone_challenge_business_id_staff_user_id_fk;
ALTER TABLE professional RENAME CONSTRAINT barber_barbershop_id_fk TO professional_business_id_fk;
ALTER TABLE professional RENAME CONSTRAINT barber_barbershop_id_id_uk TO professional_business_id_id_uk;
ALTER TABLE professional RENAME CONSTRAINT barber_barbershop_id_staff_user_id_fk TO professional_business_id_staff_user_id_fk;
ALTER TABLE professional RENAME CONSTRAINT barber_description_ck TO professional_description_ck;
ALTER TABLE professional RENAME CONSTRAINT barber_full_name_ck TO professional_full_name_ck;
ALTER TABLE professional RENAME CONSTRAINT barber_id_pk TO professional_id_pk;
ALTER TABLE professional_booking_policy RENAME CONSTRAINT barber_booking_policy_barber_fk TO professional_booking_policy_professional_fk;
ALTER TABLE professional_booking_policy RENAME CONSTRAINT barber_booking_policy_max_advance_days_ck TO professional_booking_policy_max_advance_days_ck;
ALTER TABLE professional_booking_policy RENAME CONSTRAINT barber_booking_policy_min_advance_minutes_ck TO professional_booking_policy_min_advance_minutes_ck;
ALTER TABLE professional_booking_policy RENAME CONSTRAINT barber_booking_policy_min_advance_vs_window_ck TO professional_booking_policy_min_advance_vs_window_ck;
ALTER TABLE professional_booking_policy RENAME CONSTRAINT barber_booking_policy_pk TO professional_booking_policy_pk;
ALTER TABLE professional_booking_policy RENAME CONSTRAINT barber_booking_policy_slot_grid_minutes_ck TO professional_booking_policy_slot_grid_minutes_ck;
ALTER TABLE professional_photo RENAME CONSTRAINT barber_photo_barber_fk TO professional_photo_professional_fk;
ALTER TABLE professional_photo RENAME CONSTRAINT barber_photo_content_type_ck TO professional_photo_content_type_ck;
ALTER TABLE professional_photo RENAME CONSTRAINT barber_photo_image_size_ck TO professional_photo_image_size_ck;
ALTER TABLE professional_photo RENAME CONSTRAINT barber_photo_pk TO professional_photo_pk;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_appointment_fk TO professional_review_appointment_fk;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_appointment_id_uk TO professional_review_appointment_id_uk;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_barber_fk TO professional_review_professional_fk;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_barbershop_id_id_uk TO professional_review_business_id_id_uk;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_comment_ck TO professional_review_comment_ck;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_hidden_at_ck TO professional_review_hidden_at_ck;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_id_pk TO professional_review_id_pk;
ALTER TABLE professional_review RENAME CONSTRAINT barber_review_rating_ck TO professional_review_rating_ck;
ALTER TABLE professional_service RENAME CONSTRAINT barber_service_barber_fk TO professional_service_professional_fk;
ALTER TABLE professional_service RENAME CONSTRAINT barber_service_pk TO professional_service_pk;
ALTER TABLE professional_service RENAME CONSTRAINT barber_service_service_fk TO professional_service_service_fk;
ALTER TABLE business RENAME CONSTRAINT barbershop_address_ck TO business_address_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_brand_accent_ck TO business_brand_accent_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_business_term_ck TO business_business_term_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_business_term_gender_ck TO business_business_term_gender_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_cancellation_deadline_ck TO business_cancellation_deadline_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_contact_email_ck TO business_contact_email_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_contact_phone_ck TO business_contact_phone_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_coordinates_ck TO business_coordinates_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_google_place_id_ck TO business_google_place_id_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_id_pk TO business_id_pk;
ALTER TABLE business RENAME CONSTRAINT barbershop_late_cancellation_coherence_ck TO business_late_cancellation_coherence_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_latitude_ck TO business_latitude_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_login_otp_channel_ck TO business_login_otp_channel_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_longitude_ck TO business_longitude_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_max_advance_days_ck TO business_max_advance_days_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_min_advance_minutes_ck TO business_min_advance_minutes_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_min_advance_vs_window_ck TO business_min_advance_vs_window_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_name_ck TO business_name_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_panel_profile_ck TO business_panel_profile_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_professional_term_ck TO business_professional_term_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_professional_term_gender_ck TO business_professional_term_gender_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_professional_term_plural_ck TO business_professional_term_plural_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_public_slug_ck TO business_public_slug_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_reminder_lead_minutes_ck TO business_reminder_lead_minutes_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_slot_grid_minutes_ck TO business_slot_grid_minutes_ck;
ALTER TABLE business RENAME CONSTRAINT barbershop_timezone_ck TO business_timezone_ck;
ALTER TABLE business_opening_hour RENAME CONSTRAINT barbershop_opening_hour_barbershop_id_fk TO business_opening_hour_business_id_fk;
ALTER TABLE business_opening_hour RENAME CONSTRAINT barbershop_opening_hour_id_pk TO business_opening_hour_id_pk;
ALTER TABLE business_opening_hour RENAME CONSTRAINT barbershop_opening_hour_iso_weekday_ck TO business_opening_hour_iso_weekday_ck;
ALTER TABLE business_opening_hour RENAME CONSTRAINT barbershop_opening_hour_range_ck TO business_opening_hour_range_ck;
ALTER TABLE business_opening_hour RENAME CONSTRAINT barbershop_opening_hour_shop_weekday_opens_uk TO business_opening_hour_shop_weekday_opens_uk;
ALTER TABLE business_opening_hour RENAME CONSTRAINT barbershop_opening_hour_whole_minutes_ck TO business_opening_hour_whole_minutes_ck;
ALTER TABLE customer RENAME CONSTRAINT customer_barbershop_id_fk TO customer_business_id_fk;
ALTER TABLE customer RENAME CONSTRAINT customer_barbershop_id_id_uk TO customer_business_id_id_uk;
ALTER TABLE customer_access_challenge RENAME CONSTRAINT customer_access_challenge_barbershop_id_appointment_id_fk TO customer_access_challenge_business_id_appointment_id_fk;
ALTER TABLE customer_access_challenge RENAME CONSTRAINT customer_access_challenge_barbershop_id_customer_id_fk TO customer_access_challenge_business_id_customer_id_fk;
ALTER TABLE customer_access_challenge RENAME CONSTRAINT customer_access_challenge_barbershop_id_fk TO customer_access_challenge_business_id_fk;
ALTER TABLE google_calendar_connection RENAME CONSTRAINT google_calendar_connection_barber_fk TO google_calendar_connection_professional_fk;
ALTER TABLE google_calendar_connection RENAME CONSTRAINT google_calendar_connection_barbershop_id_barber_id_uk TO google_calendar_connection_business_id_professional_id_uk;
ALTER TABLE google_calendar_connection RENAME CONSTRAINT google_calendar_connection_barbershop_id_id_uk TO google_calendar_connection_business_id_id_uk;
ALTER TABLE google_calendar_oauth_state RENAME CONSTRAINT google_calendar_oauth_state_barber_fk TO google_calendar_oauth_state_professional_fk;
ALTER TABLE idempotency_record RENAME CONSTRAINT idempotency_record_barbershop_id_fk TO idempotency_record_business_id_fk;
ALTER TABLE idempotency_record RENAME CONSTRAINT idempotency_record_barbershop_id_key_uk TO idempotency_record_business_id_key_uk;
ALTER TABLE service RENAME CONSTRAINT service_barbershop_id_fk TO service_business_id_fk;
ALTER TABLE service RENAME CONSTRAINT service_barbershop_id_id_uk TO service_business_id_id_uk;
ALTER TABLE staff_credential RENAME CONSTRAINT staff_credential_barbershop_id_staff_user_id_fk TO staff_credential_business_id_staff_user_id_fk;
ALTER TABLE staff_recovery_code RENAME CONSTRAINT staff_recovery_code_barbershop_id_staff_user_id_fk TO staff_recovery_code_business_id_staff_user_id_fk;
ALTER TABLE staff_session RENAME CONSTRAINT staff_session_barbershop_id_staff_user_id_fk TO staff_session_business_id_staff_user_id_fk;
ALTER TABLE staff_user RENAME CONSTRAINT staff_user_barbershop_id_fk TO staff_user_business_id_fk;
ALTER TABLE staff_user RENAME CONSTRAINT staff_user_barbershop_id_id_uk TO staff_user_business_id_id_uk;
ALTER TABLE time_block RENAME CONSTRAINT time_block_barbershop_id_barber_id_fk TO time_block_business_id_professional_id_fk;
ALTER TABLE time_block RENAME CONSTRAINT time_block_barbershop_id_deleted_by_fk TO time_block_business_id_deleted_by_fk;
ALTER TABLE time_block_series RENAME CONSTRAINT time_block_series_barbershop_id_barber_id_fk TO time_block_series_business_id_professional_id_fk;
ALTER TABLE time_block_series RENAME CONSTRAINT time_block_series_barbershop_id_id_uk TO time_block_series_business_id_id_uk;
ALTER TABLE time_block_series_date RENAME CONSTRAINT time_block_series_date_barbershop_id_series_id_fk TO time_block_series_date_business_id_series_id_fk;
ALTER TABLE time_block_series_exception RENAME CONSTRAINT time_block_series_exception_barbershop_id_series_id_fk TO time_block_series_exception_business_id_series_id_fk;
ALTER TABLE working_hour RENAME CONSTRAINT working_hour_barbershop_id_barber_id_fk TO working_hour_business_id_professional_id_fk;
ALTER TABLE working_hour RENAME CONSTRAINT working_hour_shop_barber_weekday_start_uk TO working_hour_shop_professional_weekday_start_uk;
ALTER TABLE working_hour_override RENAME CONSTRAINT working_hour_override_barbershop_id_barber_id_fk TO working_hour_override_business_id_professional_id_fk;
ALTER TABLE working_hour_override RENAME CONSTRAINT working_hour_override_barbershop_id_id_uk TO working_hour_override_business_id_id_uk;
ALTER TABLE working_hour_override RENAME CONSTRAINT working_hour_override_shop_barber_date_uk TO working_hour_override_shop_professional_date_uk;
ALTER TABLE working_hour_override_segment RENAME CONSTRAINT working_hour_override_segment_barbershop_id_override_id_fk TO working_hour_override_segment_business_id_override_id_fk;
ALTER INDEX barber_barbershop_id_staff_user_id_uk RENAME TO professional_business_id_staff_user_id_uk;
ALTER INDEX idx_appointment_shop_barber_starts_at RENAME TO idx_appointment_shop_professional_starts_at;
ALTER INDEX idx_barber_review_shop_barber_created RENAME TO idx_professional_review_shop_professional_created;
ALTER INDEX idx_barber_service_barber_created RENAME TO idx_professional_service_professional_created;
ALTER INDEX idx_barber_service_service RENAME TO idx_professional_service_service;
ALTER INDEX idx_barber_shop_created_id RENAME TO idx_professional_shop_created_id;
ALTER INDEX idx_barbershop_public_slug RENAME TO idx_business_public_slug;
ALTER INDEX idx_time_block_series_shop_barber RENAME TO idx_time_block_series_shop_professional;
ALTER INDEX idx_time_block_shop_barber_starts_at RENAME TO idx_time_block_shop_professional_starts_at;
ALTER INDEX idx_working_hour_override_shop_barber_date RENAME TO idx_working_hour_override_shop_professional_date;
ALTER INDEX idx_working_hour_shop_barber_weekday_start RENAME TO idx_working_hour_shop_professional_weekday_start;
ALTER TRIGGER barber_set_updated_at ON professional RENAME TO professional_set_updated_at;
ALTER TRIGGER barber_booking_policy_set_updated_at ON professional_booking_policy RENAME TO professional_booking_policy_set_updated_at;
ALTER TRIGGER barber_photo_set_updated_at ON professional_photo RENAME TO professional_photo_set_updated_at;
ALTER TRIGGER barber_review_check_appointment_trg ON professional_review RENAME TO professional_review_check_appointment_trg;
ALTER TRIGGER barbershop_set_updated_at ON business RENAME TO business_set_updated_at;
ALTER POLICY barber_all_admin_policy ON professional RENAME TO professional_all_admin_policy;
ALTER POLICY barber_insert_tenant_policy ON professional RENAME TO professional_insert_tenant_policy;
ALTER POLICY barber_select_tenant_policy ON professional RENAME TO professional_select_tenant_policy;
ALTER POLICY barber_update_tenant_policy ON professional RENAME TO professional_update_tenant_policy;
ALTER POLICY barber_booking_policy_all_admin_policy ON professional_booking_policy RENAME TO professional_booking_policy_all_admin_policy;
ALTER POLICY barber_booking_policy_delete_tenant_policy ON professional_booking_policy RENAME TO professional_booking_policy_delete_tenant_policy;
ALTER POLICY barber_booking_policy_insert_tenant_policy ON professional_booking_policy RENAME TO professional_booking_policy_insert_tenant_policy;
ALTER POLICY barber_booking_policy_select_tenant_policy ON professional_booking_policy RENAME TO professional_booking_policy_select_tenant_policy;
ALTER POLICY barber_booking_policy_update_tenant_policy ON professional_booking_policy RENAME TO professional_booking_policy_update_tenant_policy;
ALTER POLICY barber_photo_all_admin_policy ON professional_photo RENAME TO professional_photo_all_admin_policy;
ALTER POLICY barber_photo_delete_tenant_policy ON professional_photo RENAME TO professional_photo_delete_tenant_policy;
ALTER POLICY barber_photo_insert_tenant_policy ON professional_photo RENAME TO professional_photo_insert_tenant_policy;
ALTER POLICY barber_photo_select_tenant_policy ON professional_photo RENAME TO professional_photo_select_tenant_policy;
ALTER POLICY barber_photo_update_tenant_policy ON professional_photo RENAME TO professional_photo_update_tenant_policy;
ALTER POLICY barber_review_all_admin_policy ON professional_review RENAME TO professional_review_all_admin_policy;
ALTER POLICY barber_review_insert_tenant_policy ON professional_review RENAME TO professional_review_insert_tenant_policy;
ALTER POLICY barber_review_select_tenant_policy ON professional_review RENAME TO professional_review_select_tenant_policy;
ALTER POLICY barber_review_update_tenant_policy ON professional_review RENAME TO professional_review_update_tenant_policy;
ALTER POLICY barber_service_all_admin_policy ON professional_service RENAME TO professional_service_all_admin_policy;
ALTER POLICY barber_service_delete_tenant_policy ON professional_service RENAME TO professional_service_delete_tenant_policy;
ALTER POLICY barber_service_insert_tenant_policy ON professional_service RENAME TO professional_service_insert_tenant_policy;
ALTER POLICY barber_service_select_tenant_policy ON professional_service RENAME TO professional_service_select_tenant_policy;
ALTER POLICY barbershop_all_admin_policy ON business RENAME TO business_all_admin_policy;
ALTER POLICY barbershop_select_tenant_policy ON business RENAME TO business_select_tenant_policy;
ALTER POLICY barbershop_update_tenant_policy ON business RENAME TO business_update_tenant_policy;
ALTER POLICY barbershop_opening_hour_all_admin_policy ON business_opening_hour RENAME TO business_opening_hour_all_admin_policy;
ALTER POLICY barbershop_opening_hour_delete_tenant_policy ON business_opening_hour RENAME TO business_opening_hour_delete_tenant_policy;
ALTER POLICY barbershop_opening_hour_insert_tenant_policy ON business_opening_hour RENAME TO business_opening_hour_insert_tenant_policy;
ALTER POLICY barbershop_opening_hour_select_tenant_policy ON business_opening_hour RENAME TO business_opening_hour_select_tenant_policy;

-- 2. Políticas: la variable de sesión pasa a app.business_id
ALTER POLICY appointment_insert_tenant_policy ON appointment
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_select_tenant_policy ON appointment
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_update_tenant_policy ON appointment
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_access_token_insert_tenant_policy ON appointment_access_token
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_access_token_select_tenant_policy ON appointment_access_token
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_access_token_update_tenant_policy ON appointment_access_token
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_history_insert_tenant_policy ON appointment_history
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_history_select_tenant_policy ON appointment_history
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_history_change_insert_tenant_policy ON appointment_history_change
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_history_change_select_tenant_policy ON appointment_history_change
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_notice_insert_tenant_policy ON appointment_notice
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_notice_select_tenant_policy ON appointment_notice
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_notice_update_tenant_policy ON appointment_notice
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY appointment_notice_attempt_select_tenant_policy ON appointment_notice_attempt
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY business_select_tenant_policy ON business
  USING ((id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY business_update_tenant_policy ON business
  USING ((id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY business_opening_hour_delete_tenant_policy ON business_opening_hour
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY business_opening_hour_insert_tenant_policy ON business_opening_hour
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY business_opening_hour_select_tenant_policy ON business_opening_hour
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY customer_insert_tenant_policy ON customer
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY customer_select_tenant_policy ON customer
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY customer_update_tenant_policy ON customer
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY customer_access_challenge_insert_tenant_policy ON customer_access_challenge
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY customer_access_challenge_select_tenant_policy ON customer_access_challenge
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY customer_access_challenge_update_tenant_policy ON customer_access_challenge
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_connection_insert_tenant_policy ON google_calendar_connection
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_connection_select_tenant_policy ON google_calendar_connection
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_connection_update_tenant_policy ON google_calendar_connection
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_event_link_select_tenant_policy ON google_calendar_event_link
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_oauth_state_delete_tenant_policy ON google_calendar_oauth_state
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_oauth_state_insert_tenant_policy ON google_calendar_oauth_state
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_oauth_state_select_tenant_policy ON google_calendar_oauth_state
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_oauth_state_update_tenant_policy ON google_calendar_oauth_state
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_sync_job_delete_tenant_policy ON google_calendar_sync_job
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_sync_job_insert_tenant_policy ON google_calendar_sync_job
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_sync_job_select_tenant_policy ON google_calendar_sync_job
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY google_calendar_sync_job_update_tenant_policy ON google_calendar_sync_job
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY idempotency_record_select_tenant_policy ON idempotency_record
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_insert_tenant_policy ON professional
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_select_tenant_policy ON professional
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_update_tenant_policy ON professional
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_booking_policy_delete_tenant_policy ON professional_booking_policy
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_booking_policy_insert_tenant_policy ON professional_booking_policy
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_booking_policy_select_tenant_policy ON professional_booking_policy
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_booking_policy_update_tenant_policy ON professional_booking_policy
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_photo_delete_tenant_policy ON professional_photo
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_photo_insert_tenant_policy ON professional_photo
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_photo_select_tenant_policy ON professional_photo
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_photo_update_tenant_policy ON professional_photo
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_review_insert_tenant_policy ON professional_review
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_review_select_tenant_policy ON professional_review
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_review_update_tenant_policy ON professional_review
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_service_delete_tenant_policy ON professional_service
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_service_insert_tenant_policy ON professional_service
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY professional_service_select_tenant_policy ON professional_service
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY service_insert_tenant_policy ON service
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY service_select_tenant_policy ON service
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY service_update_tenant_policy ON service
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_credential_insert_tenant_policy ON staff_credential
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_credential_update_tenant_policy ON staff_credential
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_session_delete_tenant_policy ON staff_session
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_session_insert_tenant_policy ON staff_session
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_session_select_tenant_policy ON staff_session
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_session_update_tenant_policy ON staff_session
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_user_delete_tenant_policy ON staff_user
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_user_insert_tenant_policy ON staff_user
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_user_select_tenant_policy ON staff_user
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_user_update_tenant_policy ON staff_user
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY staff_user_role_select_tenant_policy ON staff_user_role
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_insert_tenant_policy ON time_block
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_select_tenant_policy ON time_block
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_update_tenant_policy ON time_block
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_insert_tenant_policy ON time_block_series
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_select_tenant_policy ON time_block_series
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_update_tenant_policy ON time_block_series
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_date_delete_tenant_policy ON time_block_series_date
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_date_insert_tenant_policy ON time_block_series_date
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_date_select_tenant_policy ON time_block_series_date
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_exception_delete_tenant_policy ON time_block_series_exception
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_exception_insert_tenant_policy ON time_block_series_exception
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY time_block_series_exception_select_tenant_policy ON time_block_series_exception
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_delete_tenant_policy ON working_hour
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_insert_tenant_policy ON working_hour
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_select_tenant_policy ON working_hour
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_update_tenant_policy ON working_hour
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_delete_tenant_policy ON working_hour_override
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_insert_tenant_policy ON working_hour_override
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_select_tenant_policy ON working_hour_override
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_update_tenant_policy ON working_hour_override
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_segment_delete_tenant_policy ON working_hour_override_segment
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_segment_insert_tenant_policy ON working_hour_override_segment
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_segment_select_tenant_policy ON working_hour_override_segment
  USING ((business_id = (current_setting('app.business_id'::text))::uuid));

ALTER POLICY working_hour_override_segment_update_tenant_policy ON working_hour_override_segment
  USING ((business_id = (current_setting('app.business_id'::text))::uuid))
  WITH CHECK ((business_id = (current_setting('app.business_id'::text))::uuid));

-- 3. Funciones: cuerpo, nombre y parámetros con los nombres nuevos
CREATE OR REPLACE FUNCTION public.auth_get_credential(p_staff_user_id uuid)
 RETURNS TABLE(password_hash text, password_algorithm text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.password_hash, c.password_algorithm
  FROM public.staff_credential c
  WHERE c.staff_user_id = p_staff_user_id
    AND c.business_id = current_setting('app.business_id')::uuid
$function$;

COMMENT ON FUNCTION public.auth_get_credential(p_staff_user_id uuid) IS 'Lectura estrecha de material de autenticación (DDL-AUT-01): un único staff_user_id, acotado al tenant vigente por app.business_id. Sustituye el SELECT directo sobre staff_credential, que queda sin GRANT ni política de SELECT para barberia_app.';

CREATE OR REPLACE FUNCTION public.auth_phone_challenge_request(p_email text, p_ip_hash text, p_code_hash text, p_expires_seconds integer, p_rate_window_seconds integer, p_rate_max_active integer, p_rate_cooldown_seconds integer)
 RETURNS TABLE(accepted boolean, phone text, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now       timestamptz := pg_catalog.now();
  v_user      record;
  v_phone     text;
  v_email     text;
  v_escalated boolean;
  v_recent    integer;
BEGIN
  IF p_email IS NULL OR p_ip_hash IS NULL OR p_code_hash IS NULL
     OR p_expires_seconds IS NULL OR p_rate_window_seconds IS NULL
     OR p_rate_max_active IS NULL OR p_rate_cooldown_seconds IS NULL THEN
    RAISE EXCEPTION 'auth_phone_challenge_request: ningún argumento admite NULL.';
  END IF;
  IF char_length(p_ip_hash) <> 64 OR char_length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'auth_phone_challenge_request: ip_hash/code_hash deben ser HMAC-SHA256 (64 hex).';
  END IF;
  IF p_expires_seconds < 1 OR p_rate_window_seconds < 1
     OR p_rate_max_active < 1 OR p_rate_cooldown_seconds < 1 THEN
    RAISE EXCEPTION 'auth_phone_challenge_request: parámetros fuera de rango.';
  END IF;

  SELECT u.id, u.business_id, u.email, u.phone,
         (u.phone_verified_at IS NOT NULL) AS phone_verified,
         b.login_otp_channel AS channel
  INTO v_user
  FROM public.staff_user u
  JOIN public.business b ON b.id = u.business_id
  WHERE u.email = pg_catalog.lower(p_email)
    AND u.is_active;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Solo el canal configurado y solo contactos de la cuenta; ningún destino
  -- viene del llamador ni se sustituye por otro canal (DEC-081).
  IF v_user.channel IN ('whatsapp', 'both') AND v_user.phone_verified THEN
    v_phone := v_user.phone;
  END IF;
  IF v_user.channel IN ('email', 'both') THEN
    v_email := v_user.email;
  END IF;

  IF v_phone IS NULL AND v_email IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT (t.escalated_until IS NOT NULL AND t.escalated_until > v_now)
  INTO v_escalated
  FROM public.login_throttle t
  WHERE t.ip_hash = p_ip_hash;

  IF NOT FOUND OR NOT v_escalated THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.auth_phone_challenge c
    WHERE c.ip_hash = p_ip_hash
      AND c.created_at > v_now - pg_catalog.make_interval(secs => p_rate_cooldown_seconds)
  ) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.auth_phone_challenge c
  WHERE c.ip_hash = p_ip_hash
    AND c.created_at > v_now - pg_catalog.make_interval(secs => p_rate_window_seconds);

  IF v_recent >= p_rate_max_active THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.auth_phone_challenge
    (business_id, staff_user_id, ip_hash, code_hash, expires_at)
  VALUES
    (v_user.business_id, v_user.id, p_ip_hash, p_code_hash,
     v_now + pg_catalog.make_interval(secs => p_expires_seconds));

  RETURN QUERY SELECT true, v_phone, v_email;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auth_phone_challenge_verify(p_email text, p_ip_hash text, p_code_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now  timestamptz := pg_catalog.now();
  v_user record;
  v_row  public.auth_phone_challenge%ROWTYPE;
BEGIN
  IF p_email IS NULL OR p_ip_hash IS NULL OR p_code_hash IS NULL THEN
    RAISE EXCEPTION 'auth_phone_challenge_verify: ningún argumento admite NULL.';
  END IF;
  IF char_length(p_ip_hash) <> 64 OR char_length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'auth_phone_challenge_verify: ip_hash/code_hash deben ser HMAC-SHA256 (64 hex).';
  END IF;

  SELECT u.id, u.business_id
  INTO v_user
  FROM public.staff_user u
  WHERE u.email = pg_catalog.lower(p_email)
    AND u.is_active;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_row
  FROM public.auth_phone_challenge c
  WHERE c.business_id = v_user.business_id
    AND c.staff_user_id = v_user.id
    AND c.ip_hash = p_ip_hash
    AND c.consumed_at IS NULL
    AND c.invalidated_at IS NULL
    AND c.expires_at > v_now
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_row.code_hash <> p_code_hash THEN
    UPDATE public.auth_phone_challenge
    SET attempt_count = attempt_count + 1,
        invalidated_at = CASE WHEN attempt_count + 1 >= max_attempts THEN v_now END
    WHERE id = v_row.id;
    RETURN false;
  END IF;

  UPDATE public.auth_phone_challenge SET consumed_at = v_now WHERE id = v_row.id;

  UPDATE public.login_throttle
  SET escalated_until = NULL,
      attempt_count   = 0,
      window_started_at = v_now
  WHERE ip_hash = p_ip_hash;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auth_recovery_change_password(p_email text, p_reset_token_hash text, p_new_password_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now  timestamptz := pg_catalog.now();
  v_user record;
  v_row  public.staff_recovery_code%ROWTYPE;
BEGIN
  IF p_email IS NULL OR p_reset_token_hash IS NULL OR p_new_password_hash IS NULL THEN
    RAISE EXCEPTION 'auth_recovery_change_password: ningún argumento admite NULL.';
  END IF;
  IF char_length(p_reset_token_hash) <> 64 THEN
    RAISE EXCEPTION 'auth_recovery_change_password: reset_token_hash debe tener 64 hex.';
  END IF;
  IF char_length(p_new_password_hash) NOT BETWEEN 32 AND 512 THEN
    RAISE EXCEPTION 'auth_recovery_change_password: new_password_hash fuera de rango.';
  END IF;

  SELECT u.id, u.business_id
  INTO v_user
  FROM public.staff_user u
  WHERE u.email = pg_catalog.lower(p_email)
    AND u.is_active;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- El artefacto se consume una vez incluso bajo dos solicitudes
  -- concurrentes: FOR UPDATE serializa la segunda detrás de la primera, que
  -- ya habrá fijado reset_token_consumed_at cuando la segunda llegue a esta
  -- fila (DEC-064, CA-008-05).
  SELECT * INTO v_row
  FROM public.staff_recovery_code c
  WHERE c.business_id = v_user.business_id
    AND c.staff_user_id = v_user.id
    AND c.reset_token_hash = p_reset_token_hash
    AND c.reset_token_consumed_at IS NULL
    AND c.reset_token_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.staff_recovery_code
  SET reset_token_consumed_at = v_now
  WHERE id = v_row.id;

  UPDATE public.staff_credential
  SET password_hash       = p_new_password_hash,
      password_algorithm  = 'argon2id',
      password_updated_at = v_now
  WHERE staff_user_id = v_user.id
    AND business_id = v_user.business_id;

  UPDATE public.staff_session
  SET revoked_at = v_now
  WHERE business_id = v_user.business_id
    AND staff_user_id = v_user.id
    AND revoked_at IS NULL;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auth_recovery_current_credential(p_email text, p_reset_token_hash text)
 RETURNS TABLE(found boolean, password_hash text, password_algorithm text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user record;
BEGIN
  IF p_email IS NULL OR p_reset_token_hash IS NULL THEN
    RAISE EXCEPTION 'auth_recovery_current_credential: ningún argumento admite NULL.';
  END IF;
  IF char_length(p_reset_token_hash) <> 64 THEN
    RAISE EXCEPTION 'auth_recovery_current_credential: reset_token_hash debe tener 64 hex.';
  END IF;

  SELECT u.id, u.business_id
  INTO v_user
  FROM public.staff_user u
  WHERE u.email = pg_catalog.lower(p_email)
    AND u.is_active;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_recovery_code c
    WHERE c.business_id = v_user.business_id
      AND c.staff_user_id = v_user.id
      AND c.reset_token_hash = p_reset_token_hash
      AND c.reset_token_consumed_at IS NULL
      AND c.reset_token_expires_at > pg_catalog.now()
  ) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT true, cr.password_hash, cr.password_algorithm
    FROM public.staff_credential cr
    WHERE cr.staff_user_id = v_user.id
      AND cr.business_id = v_user.business_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auth_recovery_request(p_email text, p_code_hash text, p_expires_seconds integer, p_max_attempts integer, p_resend_cooldown_seconds integer, p_resend_window_seconds integer, p_resend_max_per_window integer)
 RETURNS TABLE(accepted boolean, phone text, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now          timestamptz := pg_catalog.now();
  v_user         record;
  v_last_created timestamptz;
  v_recent       integer;
BEGIN
  IF p_email IS NULL OR p_code_hash IS NULL OR p_expires_seconds IS NULL
     OR p_max_attempts IS NULL OR p_resend_cooldown_seconds IS NULL
     OR p_resend_window_seconds IS NULL OR p_resend_max_per_window IS NULL THEN
    RAISE EXCEPTION 'auth_recovery_request: ningún argumento admite NULL.';
  END IF;
  IF char_length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'auth_recovery_request: code_hash debe ser HMAC-SHA256 (64 hex).';
  END IF;
  IF p_expires_seconds < 1 OR p_max_attempts NOT BETWEEN 1 AND 10
     OR p_resend_cooldown_seconds < 1 OR p_resend_window_seconds < 1
     OR p_resend_max_per_window < 1 THEN
    RAISE EXCEPTION 'auth_recovery_request: parámetros fuera de rango.';
  END IF;

  -- DEC-094: el teléfono ya no filtra la cuenta. Se lee su verificación solo
  -- para decidir más abajo si el número puede devolverse como destino.
  SELECT u.id, u.business_id, u.phone, u.phone_verified_at, u.email
  INTO v_user
  FROM public.staff_user u
  WHERE u.email = pg_catalog.lower(p_email)
    AND u.is_active;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT max(created_at) INTO v_last_created
  FROM public.staff_recovery_code
  WHERE staff_user_id = v_user.id;

  IF v_last_created IS NOT NULL
     AND v_last_created > v_now - pg_catalog.make_interval(secs => p_resend_cooldown_seconds) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.staff_recovery_code
  WHERE staff_user_id = v_user.id
    AND created_at > v_now - pg_catalog.make_interval(secs => p_resend_window_seconds);

  IF v_recent >= p_resend_max_per_window THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Reenvío: invalida atómicamente cualquier código vigente anterior en la
  -- misma escritura que crea el nuevo (DEC-064, CA-008-07). El índice único
  -- parcial de staff_recovery_code exige esto: sin este UPDATE, el INSERT de
  -- abajo violaría la unicidad si ya existiera un código vigente.
  UPDATE public.staff_recovery_code
  SET invalidated_at = v_now
  WHERE staff_user_id = v_user.id
    AND verified_at IS NULL
    AND invalidated_at IS NULL;

  INSERT INTO public.staff_recovery_code
    (business_id, staff_user_id, code_hash, max_attempts, expires_at)
  VALUES
    (v_user.business_id, v_user.id, p_code_hash, p_max_attempts,
     v_now + pg_catalog.make_interval(secs => p_expires_seconds));

  -- Un teléfono sin verificar nunca sale como destino (DEC-093, DEC-094).
  RETURN QUERY SELECT
    true,
    CASE WHEN v_user.phone_verified_at IS NOT NULL THEN v_user.phone END,
    v_user.email;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auth_recovery_verify(p_email text, p_code_hash text, p_reset_token_hash text, p_reset_expires_seconds integer)
 RETURNS TABLE(ok boolean, phone text, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now  timestamptz := pg_catalog.now();
  v_user record;
  v_row  public.staff_recovery_code%ROWTYPE;
BEGIN
  IF p_email IS NULL OR p_code_hash IS NULL OR p_reset_token_hash IS NULL
     OR p_reset_expires_seconds IS NULL THEN
    RAISE EXCEPTION 'auth_recovery_verify: ningún argumento admite NULL.';
  END IF;
  IF char_length(p_code_hash) <> 64 OR char_length(p_reset_token_hash) <> 64 THEN
    RAISE EXCEPTION 'auth_recovery_verify: code_hash/reset_token_hash deben tener 64 hex.';
  END IF;
  IF p_reset_expires_seconds < 1 THEN
    RAISE EXCEPTION 'auth_recovery_verify: p_reset_expires_seconds fuera de rango.';
  END IF;

  SELECT u.id, u.business_id, u.phone, u.email
  INTO v_user
  FROM public.staff_user u
  WHERE u.email = pg_catalog.lower(p_email)
    AND u.is_active;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.staff_recovery_code c
  WHERE c.business_id = v_user.business_id
    AND c.staff_user_id = v_user.id
    AND c.verified_at IS NULL
    AND c.invalidated_at IS NULL
    AND c.expires_at > v_now
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_row.code_hash <> p_code_hash THEN
    UPDATE public.staff_recovery_code
    SET attempt_count = attempt_count + 1,
        invalidated_at = CASE WHEN attempt_count + 1 >= max_attempts THEN v_now END
    WHERE id = v_row.id;
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE public.staff_recovery_code
  SET verified_at            = v_now,
      reset_token_hash       = p_reset_token_hash,
      reset_token_expires_at = v_now + pg_catalog.make_interval(secs => p_reset_expires_seconds)
  WHERE id = v_row.id;

  RETURN QUERY SELECT true, v_user.phone, v_user.email;
END;
$function$;

CREATE OR REPLACE FUNCTION public.authn_resolve_login_tenant(p_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT business_id
  FROM public.staff_user
  WHERE email = pg_catalog.lower(p_email)
    AND is_active
$function$;

COMMENT ON FUNCTION public.authn_resolve_login_tenant(p_email text) IS 'SECURITY DEFINER acotada: resuelve la barbería de un correo de acceso para poder fijar app.business_id. Devuelve NULL si no existe o está inactivo; quien la llama debe responder igual en ambos casos y consumir el mismo tiempo (CA-005-02, CA-005-07). No expone credenciales ni datos personales.';

CREATE OR REPLACE FUNCTION public.authn_resolve_session_tenant(p_token_hash text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT business_id
  FROM public.staff_session
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND expires_at > pg_catalog.now()
$function$;

COMMENT ON FUNCTION public.authn_resolve_session_tenant(p_token_hash text) IS 'SECURITY DEFINER acotada: resuelve la barbería de un token de sesión ya hasheado, sin exponer staff_user_id ni ninguna otra columna. Devuelve NULL para un token desconocido, revocado o vencido; HU-006 la usará para fijar app.business_id antes de reabrir la transacción tenant-aware que confirma sesión, usuario y barbería.';

ALTER FUNCTION public.barber_review_check_appointment() RENAME TO professional_review_check_appointment;

CREATE OR REPLACE FUNCTION public.professional_review_check_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status    text;
  v_professional_id uuid;
BEGIN
  SELECT status, professional_id INTO v_status, v_professional_id
  FROM appointment
  WHERE business_id = NEW.business_id AND id = NEW.appointment_id;

  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'professional_review: el turno debe estar completed (estado: %).', coalesce(v_status, 'inexistente')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'professional_review_appointment_completed_ck';
  END IF;
  IF v_professional_id IS DISTINCT FROM NEW.professional_id THEN
    RAISE EXCEPTION 'professional_review: el barbero debe ser el del turno.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'professional_review_professional_matches_appointment_ck';
  END IF;
  RETURN NEW;
END
$function$;

DROP FUNCTION public.gcal_claim_jobs(p_limit integer, p_lease_seconds integer, p_now timestamp with time zone);

CREATE OR REPLACE FUNCTION public.gcal_claim_jobs(p_limit integer, p_lease_seconds integer, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(job_id uuid, claim_token uuid, business_id uuid, connection_id uuid, resource_type text, resource_id uuid, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'gcal_claim_jobs: p_limit fuera de rango (1-100).';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'gcal_claim_jobs: p_lease_seconds fuera de rango (10-3600).';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT j.id
      FROM public.google_calendar_sync_job j
      JOIN public.google_calendar_connection c
        ON c.business_id = j.business_id AND c.id = j.connection_id
     WHERE c.status IN ('connected', 'error')
       AND (
            (j.status = 'pending' AND j.run_at <= p_now)
         OR (j.status = 'processing' AND j.lease_expires_at <= p_now)
       )
     ORDER BY j.run_at, j.created_at
     LIMIT p_limit
       FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.google_calendar_sync_job j
     SET status = 'processing',
         claim_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = p_now + pg_catalog.make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1,
         updated_at = p_now
    FROM due
   WHERE j.id = due.id
  RETURNING j.id, j.claim_token, j.business_id, j.connection_id, j.resource_type, j.resource_id, j.attempts;
END;
$function$;

REVOKE ALL ON FUNCTION public.gcal_claim_jobs(p_limit integer, p_lease_seconds integer, p_now timestamp with time zone) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.gcal_claim_jobs(p_limit integer, p_lease_seconds integer, p_now timestamp with time zone) TO barberia_worker;

COMMENT ON FUNCTION public.gcal_claim_jobs(p_limit integer, p_lease_seconds integer, p_now timestamp with time zone) IS 'Reclamo con lease de la cola de Google Calendar (DDL-CON-01): SKIP LOCKED sobre trabajos pending vencidos o processing con lease vencido de conexiones que siguen publicando. Exclusivo de barberia_worker.';

CREATE OR REPLACE FUNCTION public.gcal_enqueue_missing(p_connection_id uuid, p_resource_type text, p_resource_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  IF p_resource_type NOT IN ('appointment', 'time_block') THEN
    RAISE EXCEPTION 'gcal_enqueue_missing: tipo de recurso inválido %.', p_resource_type;
  END IF;

  INSERT INTO public.google_calendar_sync_job (business_id, connection_id, resource_type, resource_id)
  SELECT c.business_id, c.id, p_resource_type, p_resource_id
    FROM public.google_calendar_connection c
   WHERE c.id = p_connection_id AND c.status IN ('connected', 'error')
  ON CONFLICT (connection_id, resource_type, resource_id) WHERE status = 'pending' DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gcal_finish_job(p_job_id uuid, p_claim_token uuid, p_outcome text, p_event_id text DEFAULT NULL::text, p_etag text DEFAULT NULL::text, p_generation integer DEFAULT NULL::integer, p_visible_hash text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_retry_seconds integer DEFAULT NULL::integer, p_max_attempts integer DEFAULT 8, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_job public.google_calendar_sync_job%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('published', 'removed', 'skipped', 'retry', 'reauth', 'permanent') THEN
    RAISE EXCEPTION 'gcal_finish_job: resultado inválido %.', p_outcome;
  END IF;

  -- CAS: solo quien tiene la reclamación vigente finaliza.
  SELECT * INTO v_job
    FROM public.google_calendar_sync_job
   WHERE id = p_job_id AND claim_token = p_claim_token AND status = 'processing'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_outcome = 'published' THEN
    IF p_event_id IS NULL OR p_generation IS NULL THEN
      RAISE EXCEPTION 'gcal_finish_job: published exige p_event_id y p_generation.';
    END IF;
    INSERT INTO public.google_calendar_event_link
           (connection_id, resource_type, resource_id, business_id, google_event_id, etag,
            event_generation, visible_hash)
    VALUES (v_job.connection_id, v_job.resource_type, v_job.resource_id, v_job.business_id,
            p_event_id, p_etag, p_generation, p_visible_hash)
    ON CONFLICT (connection_id, resource_type, resource_id) DO UPDATE
       SET google_event_id = EXCLUDED.google_event_id, etag = EXCLUDED.etag,
           event_generation = EXCLUDED.event_generation, visible_hash = EXCLUDED.visible_hash;
    UPDATE public.google_calendar_connection
       SET last_synced_at = p_now, last_error_code = NULL,
           status = CASE WHEN status = 'error' THEN 'connected' ELSE status END
     WHERE business_id = v_job.business_id AND id = v_job.connection_id;
    DELETE FROM public.google_calendar_sync_job WHERE id = v_job.id;

  ELSIF p_outcome = 'removed' THEN
    DELETE FROM public.google_calendar_event_link
     WHERE connection_id = v_job.connection_id
       AND resource_type = v_job.resource_type AND resource_id = v_job.resource_id;
    DELETE FROM public.google_calendar_sync_job WHERE id = v_job.id;

  ELSIF p_outcome = 'skipped' THEN
    DELETE FROM public.google_calendar_sync_job WHERE id = v_job.id;

  ELSIF p_outcome = 'retry' THEN
    IF v_job.attempts >= COALESCE(p_max_attempts, 8) THEN
      UPDATE public.google_calendar_sync_job
         SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
             last_error_code = p_error_code
       WHERE id = v_job.id;
    ELSE
      UPDATE public.google_calendar_sync_job
         SET status = 'pending', claim_token = NULL, lease_expires_at = NULL,
             run_at = p_now + pg_catalog.make_interval(secs => COALESCE(p_retry_seconds, 60)),
             last_error_code = p_error_code
       WHERE id = v_job.id;
    END IF;

  ELSIF p_outcome = 'reauth' THEN
    -- Google ya no acepta el permiso: se borran las credenciales y se vacía la cola de esa
    -- conexión (al reconectar, la publicación inicial vuelve a encolar lo vigente).
    UPDATE public.google_calendar_connection
       SET status = 'reauth_required', refresh_token_ciphertext = NULL, token_key_id = NULL,
           last_error_code = COALESCE(p_error_code, 'token_revoked')
     WHERE business_id = v_job.business_id AND id = v_job.connection_id;
    DELETE FROM public.google_calendar_sync_job
     WHERE business_id = v_job.business_id AND connection_id = v_job.connection_id;

  ELSE  -- 'permanent': permiso denegado, calendario eliminado... el token sigue siendo válido
    UPDATE public.google_calendar_sync_job
       SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
           last_error_code = p_error_code
     WHERE id = v_job.id;
    UPDATE public.google_calendar_connection
       SET status = 'error', last_error_code = p_error_code
     WHERE business_id = v_job.business_id AND id = v_job.connection_id
       AND status IN ('connected', 'error');
  END IF;

  RETURN true;
END;
$function$;

DROP FUNCTION public.gcal_job_context(p_job_id uuid, p_claim_token uuid);

CREATE OR REPLACE FUNCTION public.gcal_job_context(p_job_id uuid, p_claim_token uuid)
 RETURNS TABLE(professional_id uuid, connection_status text, calendar_id text, reminder_minutes integer, token_ciphertext bytea, token_key_id text, business_timezone text, link_event_id text, link_generation integer, link_visible_hash text, resource_type text, resource_id uuid, resource_found boolean, professional_matches boolean, appt_status text, starts_at timestamp with time zone, ends_at timestamp with time zone, attendee_name text, service_name text, customer_email text, block_type text, block_source text, block_deleted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.professional_id, c.status, c.calendar_id, c.reminder_minutes, c.refresh_token_ciphertext, c.token_key_id,
         b.timezone,
         l.google_event_id, l.event_generation, l.visible_hash,
         j.resource_type, j.resource_id,
         (a.id IS NOT NULL OR t.id IS NOT NULL),
         COALESCE(a.professional_id, t.professional_id) = c.professional_id,
         a.status, COALESCE(a.starts_at, t.starts_at), COALESCE(a.ends_at, t.ends_at),
         a.attendee_name, a.service_name_snapshot, cu.email,
         t.block_type, t.source, (t.deleted_at IS NOT NULL)
    FROM public.google_calendar_sync_job j
    JOIN public.google_calendar_connection c
      ON c.business_id = j.business_id AND c.id = j.connection_id
    JOIN public.business b ON b.id = j.business_id
    LEFT JOIN public.google_calendar_event_link l
      ON l.connection_id = j.connection_id
     AND l.resource_type = j.resource_type AND l.resource_id = j.resource_id
    LEFT JOIN public.appointment a
      ON j.resource_type = 'appointment' AND a.business_id = j.business_id AND a.id = j.resource_id
    LEFT JOIN public.customer cu
      ON cu.business_id = a.business_id AND cu.id = a.customer_id
    LEFT JOIN public.time_block t
      ON j.resource_type = 'time_block' AND t.business_id = j.business_id AND t.id = j.resource_id
   WHERE j.id = p_job_id AND j.claim_token = p_claim_token AND j.status = 'processing';
$function$;

REVOKE ALL ON FUNCTION public.gcal_job_context(p_job_id uuid, p_claim_token uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.gcal_job_context(p_job_id uuid, p_claim_token uuid) TO barberia_worker;

COMMENT ON FUNCTION public.gcal_job_context(p_job_id uuid, p_claim_token uuid) IS 'Datos mínimos para publicar UN trabajo reclamado; exige su claim_token vigente, así que no sirve para leer citas arbitrarias. Incluye el correo del cliente solo para invitarlo (DEC-122). Exclusivo de barberia_worker.';

DROP FUNCTION public.gcal_restore_claim_connection(p_interval_seconds integer, p_now timestamp with time zone);

CREATE OR REPLACE FUNCTION public.gcal_restore_claim_connection(p_interval_seconds integer, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(connection_id uuid, business_id uuid, professional_id uuid, calendar_id text, token_ciphertext bytea, token_key_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
  IF p_interval_seconds IS NULL OR p_interval_seconds < 30 OR p_interval_seconds > 86400 THEN
    RAISE EXCEPTION 'gcal_restore_claim_connection: p_interval_seconds fuera de rango (30-86400).';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT c.id
      FROM public.google_calendar_connection c
     WHERE c.status = 'connected'
       AND (c.last_restore_check_at IS NULL
            OR c.last_restore_check_at <= p_now - pg_catalog.make_interval(secs => p_interval_seconds))
     ORDER BY c.last_restore_check_at NULLS FIRST
     LIMIT 1
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.google_calendar_connection c
     SET last_restore_check_at = p_now
    FROM due
   WHERE c.id = due.id
  RETURNING c.id, c.business_id, c.professional_id, c.calendar_id, c.refresh_token_ciphertext, c.token_key_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.gcal_restore_claim_connection(p_interval_seconds integer, p_now timestamp with time zone) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.gcal_restore_claim_connection(p_interval_seconds integer, p_now timestamp with time zone) TO barberia_worker;

COMMENT ON FUNCTION public.gcal_restore_claim_connection(p_interval_seconds integer, p_now timestamp with time zone) IS 'Reserva (SKIP LOCKED) la siguiente conexión conectada cuyo chequeo de eventos borrados venció. Exclusivo de barberia_worker.';

CREATE OR REPLACE FUNCTION public.gcal_restore_links(p_connection_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(resource_type text, resource_id uuid, google_event_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Solo recursos que SIGUEN vigentes y futuros: una cita cancelada en la app, terminal o
  -- pasada y un bloqueo retirado nunca se recrean (DEC-101).
  SELECT l.resource_type, l.resource_id, l.google_event_id
    FROM public.google_calendar_event_link l
    LEFT JOIN public.appointment a
      ON l.resource_type = 'appointment' AND a.business_id = l.business_id AND a.id = l.resource_id
    LEFT JOIN public.time_block t
      ON l.resource_type = 'time_block' AND t.business_id = l.business_id AND t.id = l.resource_id
   WHERE l.connection_id = p_connection_id
     AND (
          (a.id IS NOT NULL AND a.status = 'confirmed' AND a.ends_at > p_now)
       OR (t.id IS NOT NULL AND t.deleted_at IS NULL AND t.ends_at > p_now)
     );
$function$;

DROP FUNCTION public.idempotency_abort(p_barbershop_id uuid, p_idempotency_key text);

CREATE OR REPLACE FUNCTION public.idempotency_abort(p_business_id uuid, p_idempotency_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF p_business_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_abort: ningún argumento admite NULL.';
  END IF;

  -- Cierra DDL-IDEM-01: solo borra una fila 'in_progress' (el efecto
  -- fracasó y no debe bloquear un reintento legítimo). Una fila
  -- 'completed' jamás se borra desde aquí ni desde ningún otro camino del
  -- API, así que un reintento no puede repetir un efecto crítico ya hecho.
  DELETE FROM public.idempotency_record
  WHERE business_id = p_business_id
    AND idempotency_key = p_idempotency_key
    AND status = 'in_progress';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.idempotency_abort(p_business_id uuid, p_idempotency_key text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.idempotency_abort(p_business_id uuid, p_idempotency_key text) TO barberia_app;

COMMENT ON FUNCTION public.idempotency_abort(p_business_id uuid, p_idempotency_key text) IS 'Limpia una reclamación cuyo efecto falló. Solo borra in_progress: nunca borra una fila completed (cierra DDL-IDEM-01).';

DROP FUNCTION public.idempotency_begin(p_barbershop_id uuid, p_idempotency_key text, p_operation text, p_request_fingerprint text, p_ttl_seconds integer);

CREATE OR REPLACE FUNCTION public.idempotency_begin(p_business_id uuid, p_idempotency_key text, p_operation text, p_request_fingerprint text, p_ttl_seconds integer)
 RETURNS TABLE(outcome text, response_status smallint, response_content_type text, response_body text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_lock_key bigint;
  v_locked   boolean;
  v_row      public.idempotency_record%ROWTYPE;
BEGIN
  IF p_business_id IS NULL OR p_idempotency_key IS NULL OR p_operation IS NULL
     OR p_request_fingerprint IS NULL OR p_ttl_seconds IS NULL THEN
    RAISE EXCEPTION 'idempotency_begin: ningún argumento admite NULL.';
  END IF;
  IF p_ttl_seconds < 1 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'idempotency_begin: p_ttl_seconds fuera de rango (1-86400).';
  END IF;
  IF btrim(p_idempotency_key) = '' OR char_length(p_idempotency_key) > 255 THEN
    RAISE EXCEPTION 'idempotency_begin: idempotency_key inválida.';
  END IF;
  IF btrim(p_operation) = '' OR char_length(p_operation) > 120 THEN
    RAISE EXCEPTION 'idempotency_begin: operation inválida.';
  END IF;
  IF p_request_fingerprint !~ '^[0-9a-f]{32,128}$' THEN
    RAISE EXCEPTION 'idempotency_begin: request_fingerprint inválido.';
  END IF;

  -- Bloqueo consultivo transaccional (DEC-043): se libera solo al terminar
  -- la transacción (COMMIT o ROLLBACK), nunca queda huérfano entre
  -- solicitudes. `pg_try_advisory_xact_lock` no espera: si otra sesión ya
  -- lo tiene, retorna false de inmediato.
  v_lock_key := pg_catalog.hashtextextended(
    p_business_id::text || ':' || p_idempotency_key, 0
  );
  v_locked := pg_catalog.pg_try_advisory_xact_lock(v_lock_key);

  IF NOT v_locked THEN
    RETURN QUERY SELECT 'locked'::text, NULL::smallint, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.idempotency_record
  WHERE business_id = p_business_id
    AND idempotency_key = p_idempotency_key;

  IF NOT FOUND OR v_row.expires_at <= pg_catalog.now() THEN
    -- No existe, o existe vencida: se reclama atómicamente aunque el
    -- mantenimiento (idempotency_purge_expired) todavía no la haya
    -- limpiado. El lock ya tomado impide que dos sesiones reclamen la
    -- misma clave a la vez.
    DELETE FROM public.idempotency_record
    WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key;

    INSERT INTO public.idempotency_record (
      business_id, idempotency_key, operation, request_fingerprint,
      status, expires_at
    ) VALUES (
      p_business_id, p_idempotency_key, p_operation, p_request_fingerprint,
      'in_progress', pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds)
    );

    RETURN QUERY SELECT 'proceed'::text, NULL::smallint, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_row.operation <> p_operation THEN
    -- RN-IDE-01: una clave ya usada no se reutiliza para otra operación.
    RETURN QUERY SELECT 'conflict_operation'::text, NULL::smallint, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_row.status = 'completed' THEN
    IF v_row.request_fingerprint = p_request_fingerprint THEN
      RETURN QUERY SELECT
        'replay'::text, v_row.response_status, v_row.response_content_type, v_row.response_body;
    ELSE
      RETURN QUERY SELECT 'conflict_fingerprint'::text, NULL::smallint, NULL::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  -- status = 'in_progress', vigente, misma operación: otra ejecución
  -- legítima sigue en curso (poco frecuente bajo el lock, pero posible si
  -- el TTL de una reclamación previa aún no venció).
  RETURN QUERY SELECT 'conflict_in_progress'::text, NULL::smallint, NULL::text, NULL::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.idempotency_begin(p_business_id uuid, p_idempotency_key text, p_operation text, p_request_fingerprint text, p_ttl_seconds integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.idempotency_begin(p_business_id uuid, p_idempotency_key text, p_operation text, p_request_fingerprint text, p_ttl_seconds integer) TO barberia_app;

COMMENT ON FUNCTION public.idempotency_begin(p_business_id uuid, p_idempotency_key text, p_operation text, p_request_fingerprint text, p_ttl_seconds integer) IS 'Punto de entrada único del protocolo de idempotencia (DEC-043). Toma un bloqueo consultivo transaccional por (business_id, idempotency_key); si no puede, responde "locked" sin esperar. Nunca deja la tabla en un estado a medio escribir.';

DROP FUNCTION public.idempotency_complete(p_barbershop_id uuid, p_idempotency_key text, p_response_status integer, p_response_content_type text, p_response_body text);

CREATE OR REPLACE FUNCTION public.idempotency_complete(p_business_id uuid, p_idempotency_key text, p_response_status integer, p_response_content_type text, p_response_body text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_business_id IS NULL OR p_idempotency_key IS NULL OR p_response_status IS NULL
     OR p_response_content_type IS NULL OR p_response_body IS NULL THEN
    RAISE EXCEPTION 'idempotency_complete: ningún argumento admite NULL.';
  END IF;
  IF p_response_status NOT BETWEEN 100 AND 599 THEN
    RAISE EXCEPTION 'idempotency_complete: response_status fuera de rango.';
  END IF;

  -- Solo transiciona una fila que sigue 'in_progress': confirmar dos veces
  -- la misma clave no duplica nada, y nunca sobrescribe una ya completada.
  UPDATE public.idempotency_record
  SET status                 = 'completed',
      response_status        = p_response_status,
      response_content_type  = p_response_content_type,
      response_body          = p_response_body
  WHERE business_id = p_business_id
    AND idempotency_key = p_idempotency_key
    AND status = 'in_progress';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.idempotency_complete(p_business_id uuid, p_idempotency_key text, p_response_status integer, p_response_content_type text, p_response_body text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.idempotency_complete(p_business_id uuid, p_idempotency_key text, p_response_status integer, p_response_content_type text, p_response_body text) TO barberia_app;

COMMENT ON FUNCTION public.idempotency_complete(p_business_id uuid, p_idempotency_key text, p_response_status integer, p_response_content_type text, p_response_body text) IS 'Confirma una operación en curso con su respuesta. Solo transiciona una fila in_progress; no reescribe una fila ya completed.';

DROP FUNCTION public.notice_context(p_notice_id uuid, p_claim_token uuid);

CREATE OR REPLACE FUNCTION public.notice_context(p_notice_id uuid, p_claim_token uuid)
 RETURNS TABLE(kind text, appointment_status text, starts_at timestamp with time zone, appointment_state_at timestamp with time zone, customer_email text, attendee_name text, service_name text, business_name text, business_timezone text, already_covered boolean, notice_state_at timestamp with time zone, customer_phone text, professional_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT n.kind, a.status, a.starts_at, a.updated_at,
         cu.email, a.attendee_name, a.service_name_snapshot, b.name, b.timezone,
         EXISTS (
           SELECT 1 FROM public.appointment_notice o
            WHERE o.business_id = n.business_id AND o.appointment_id = n.appointment_id
              AND o.id <> n.id AND o.status = 'sent'
              AND CASE WHEN n.kind IN ('reminder', 'reminder_whatsapp')
                       THEN o.kind = n.kind AND o.covers_state_at = n.state_at
                       ELSE o.kind NOT IN ('reminder', 'reminder_whatsapp')
                            AND o.covers_state_at >= n.state_at END
         ),
         n.state_at,
         cu.phone,
         br.full_name
    FROM public.appointment_notice n
    JOIN public.appointment a ON a.business_id = n.business_id AND a.id = n.appointment_id
    JOIN public.customer cu ON cu.business_id = a.business_id AND cu.id = a.customer_id
    JOIN public.professional br ON br.business_id = a.business_id AND br.id = a.professional_id
    JOIN public.business b ON b.id = n.business_id
   WHERE n.id = p_notice_id AND n.claim_token = p_claim_token AND n.status = 'processing';
$function$;

REVOKE ALL ON FUNCTION public.notice_context(p_notice_id uuid, p_claim_token uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.notice_context(p_notice_id uuid, p_claim_token uuid) TO barberia_worker;

COMMENT ON FUNCTION public.notice_context(p_notice_id uuid, p_claim_token uuid) IS 'Datos mínimos para redactar y enviar UN aviso reclamado; exige su claim_token vigente, así que no sirve para leer citas arbitrarias. Incluye el correo, el teléfono y el nombre del cliente solo para ese envío (RN-DAT-02). notice_state_at es el estado que el aviso cubre: para un recordatorio, el instante del turno para el que se programó. Exclusivo de barberia_worker.';

CREATE OR REPLACE FUNCTION public.notice_finish(p_notice_id uuid, p_claim_token uuid, p_outcome text, p_code text DEFAULT NULL::text, p_retry_seconds integer DEFAULT NULL::integer, p_max_attempts integer DEFAULT 5, p_covers_state_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_notice  public.appointment_notice%ROWTYPE;
  v_attempt text;
BEGIN
  IF p_outcome NOT IN ('sent', 'skipped', 'retry', 'permanent') THEN
    RAISE EXCEPTION 'notice_finish: resultado inválido %.', p_outcome;
  END IF;

  SELECT * INTO v_notice
    FROM public.appointment_notice
   WHERE id = p_notice_id AND claim_token = p_claim_token AND status = 'processing'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_outcome = 'sent' THEN
    IF p_covers_state_at IS NULL THEN
      RAISE EXCEPTION 'notice_finish: sent exige p_covers_state_at.';
    END IF;
    v_attempt := 'sent';
    UPDATE public.appointment_notice
       SET status = 'sent', claim_token = NULL, lease_expires_at = NULL,
           outcome_code = NULL, covers_state_at = p_covers_state_at, finished_at = p_now
     WHERE id = v_notice.id;

  ELSIF p_outcome = 'skipped' THEN
    v_attempt := 'skipped';
    UPDATE public.appointment_notice
       SET status = 'skipped', claim_token = NULL, lease_expires_at = NULL,
           outcome_code = p_code, finished_at = p_now
     WHERE id = v_notice.id;

  ELSIF p_outcome = 'retry' AND v_notice.attempts < COALESCE(p_max_attempts, 5) THEN
    v_attempt := 'retry';
    UPDATE public.appointment_notice
       SET status = 'pending', claim_token = NULL, lease_expires_at = NULL,
           run_at = p_now + pg_catalog.make_interval(secs => COALESCE(p_retry_seconds, 60)),
           outcome_code = p_code
     WHERE id = v_notice.id;

  ELSE  -- 'permanent', o 'retry' con los intentos agotados
    v_attempt := 'failed';
    UPDATE public.appointment_notice
       SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
           outcome_code = p_code, finished_at = p_now
     WHERE id = v_notice.id;
  END IF;

  INSERT INTO public.appointment_notice_attempt
         (business_id, notice_id, attempt_no, channel, outcome, error_code, created_at)
  VALUES (v_notice.business_id, v_notice.id, v_notice.attempts,
          CASE WHEN v_notice.kind = 'reminder_whatsapp' THEN 'whatsapp' ELSE 'email' END, v_attempt,
          CASE WHEN v_attempt = 'sent' THEN NULL ELSE p_code END, p_now);

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.public_resolve_appointment_token_tenant(p_token_hash text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT business_id
  FROM public.appointment_access_token
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > pg_catalog.now())
$function$;

COMMENT ON FUNCTION public.public_resolve_appointment_token_tenant(p_token_hash text) IS 'SECURITY DEFINER acotada: resuelve el hash del token de acceso al turno (HU-098) a un identificador de barbería para poder fijar app.business_id. Devuelve NULL si el hash no existe, ya expiró o ya fue revocado; quien la llama responde igual en los tres casos (CA-098-02, RN-TEN-01). No expone la cita, el cliente ni ningún otro dato.';

DROP FUNCTION public.public_resolve_barbershop_by_slug(p_slug text);

CREATE OR REPLACE FUNCTION public.public_resolve_business_by_slug(p_slug text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT id
  FROM public.business
  WHERE public_slug IS NOT NULL
    AND pg_catalog.lower(public_slug) = pg_catalog.lower(p_slug)
$function$;

REVOKE ALL ON FUNCTION public.public_resolve_business_by_slug(p_slug text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_resolve_business_by_slug(p_slug text) TO barberia_app;

COMMENT ON FUNCTION public.public_resolve_business_by_slug(p_slug text) IS 'SECURITY DEFINER acotada: resuelve el slug del enlace público de reservas (HU-090) a un identificador de barbería para poder fijar app.business_id. Devuelve NULL si el slug no existe o no es publicable (public_slug NULL); quien la llama responde igual en ambos casos (CA-090-02, RN-TEN-01). No expone nombre, contacto ni ningún otro dato.';

CREATE OR REPLACE FUNCTION public.time_block_series_date_check_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_series public.time_block_series%ROWTYPE;
BEGIN
  SELECT * INTO v_series
  FROM public.time_block_series
  WHERE id = NEW.series_id AND business_id = NEW.business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'time_block_series % no existe en la barbería %', NEW.series_id, NEW.business_id;
  END IF;

  IF v_series.recurrence_kind <> 'date_list' THEN
    RAISE EXCEPTION 'time_block_series % no es date_list (es %): no admite fechas explícitas',
      NEW.series_id, v_series.recurrence_kind;
  END IF;

  IF NEW.block_date < v_series.effective_from
     OR (v_series.effective_until IS NOT NULL AND NEW.block_date > v_series.effective_until) THEN
    RAISE EXCEPTION 'block_date % fuera del rango efectivo [%, %] de time_block_series %',
      NEW.block_date, v_series.effective_from, v_series.effective_until, NEW.series_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.working_hour_override_segment_check_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_is_closed boolean;
BEGIN
  SELECT is_closed INTO v_is_closed
  FROM public.working_hour_override
  WHERE id = NEW.override_id AND business_id = NEW.business_id;

  IF v_is_closed IS NULL THEN
    RAISE EXCEPTION 'working_hour_override % no existe en la barbería %',
      NEW.override_id, NEW.business_id;
  END IF;

  IF v_is_closed THEN
    RAISE EXCEPTION 'working_hour_override % está cerrada (is_closed=true): no admite tramos',
      NEW.override_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Comentarios que nombran identificadores renombrados
COMMENT ON COLUMN business.closed_on_holidays IS 'El local cierra los festivos colombianos (DEC-182): el perfil público muestra «hoy» cerrado en un festivo aunque business_opening_hour tenga tramos para ese día de la semana.';
COMMENT ON COLUMN business.late_cancellation_reason_required IS 'Si una cancelación tardía del cliente (cuando late_cancellation_client_allowed es true) exige motivo (HU-093, RN-CAN-02). Default true (DEC-083); no puede ser true si late_cancellation_client_allowed es false (business_late_cancellation_coherence_ck). Propietario funcional: barbería. Clasificación: configuración.';
COMMENT ON COLUMN business.latitude IS 'Latitud (grados decimales, -90..90) resultante de geocodificar address una vez en el servidor al guardar (DEC-130). Siempre junto con longitude y solo con address no nula (business_coordinates_ck).';
COMMENT ON COLUMN business.professional_term IS 'Palabra en singular con la que la barbería llama a quien atiende los turnos (issue #292, DEC-110), en minúsculas, p. ej. barbero o estilista. Default barbero. No renombra la tabla professional ni el contrato de la API. Propietario funcional: barbería. Clasificación: configuración.';
COMMENT ON COLUMN business.public_slug IS 'Identificador del enlace público de reservas (F-PUB-01, HU-090). Generado automáticamente desde business.name la primera vez que se guarda (internal/modules/shops, DEC-082); el barbero no lo escribe. Editable desde configuración: al cambiar, el valor anterior deja de resolver, sin redirección (DEC-082). NULL = no publicable, misma respuesta uniforme que un slug desconocido (CA-090-02). Único GLOBALMENTE, comparado sin distinguir mayúsculas (idx_business_public_slug). Propietario funcional: barbería. Retención: mientras exista la cuenta. Clasificación: dato de negocio, no personal.';
COMMENT ON COLUMN business_opening_hour.opens_time IS 'Hora civil de apertura, interpretada con business.timezone (estandar-base-datos.md §5.5).';
COMMENT ON TABLE login_throttle IS 'Contadores del límite por IP del formulario de acceso (DEC-026, DEC-052). Propietario funcional: plataforma. Retención: hasta expires_at. Clasificación: técnico. ip_hash es HMAC-SHA256(secreto de despliegue, ip) (DDL-AUT-01): un hash simple, aunque con sal no pública, sigue siendo reconstruible por fuerza bruta porque el espacio de IP es pequeño (~2^32 para IPv4); HMAC con clave secreta de despliegue no lo es. La clave nunca vive en el repositorio ni en esta base de datos. Sin business_id ni RLS por diseño.';
COMMENT ON COLUMN professional.description IS 'Descripción corta y opcional del barbero (DEC-127), visible para cualquier visitante de la reserva pública. NULL = sin descripción. Texto libre de hasta 280 caracteres, sin datos personales sensibles; nunca una cadena vacía (professional_description_ck).';
COMMENT ON COLUMN professional.staff_user_id IS 'Usuario del área privada que es este barbero (issue #322, DEC-100). Opcional: NULL = el barbero no tiene usuario, o el usuario no atiende clientes. Lo establece, cambia o quita únicamente el propio usuario autenticado; nunca se infiere por nombre, correo ni teléfono, ni se asume igual a professional.id. Único por barbería en ambos sentidos. Clave foránea compuesta: solo puede apuntar a un usuario de la misma barbería. Nunca se expone por la API.';
COMMENT ON TABLE professional_booking_policy IS 'Ventana de reserva pública propia y opcional de un barbero (DEC-169): anticipación mínima, ventana máxima y paso de rejilla. Sin fila, el barbero hereda los valores de business. Propietario funcional: módulo shops (configuración de reserva). Clasificación: configuración, sin datos personales. Retención: mientras la barbería la mantenga; volver a heredar borra la fila.';
COMMENT ON TABLE professional_photo IS 'Fotografía opcional de un barbero (DEC-100), una fila como máximo por barbero. Propietario funcional: módulo staff. Clasificación: datos personales (imagen de una persona). Retención: mientras el barbero la conserve; quitarla borra la fila. Sin nombre de archivo, EXIF ni metadatos del dispositivo: solo content_type y bytes ya validados y re-codificados por el cliente. Vive aparte de `professional` para que el listado del equipo no lea los bytes.';
COMMENT ON COLUMN professional_photo.image IS 'Imagen JPEG o PNG ya validada por el servidor (formato real, dimensiones acotadas). Tope de 512 KiB (professional_photo_image_size_ck).';
COMMENT ON TABLE professional_service IS 'Asociación tenant-aware PURA entre professional y service (HU-023): qué servicios presta cada barbero. Propietario funcional: barbería, coordinado entre los módulos catalog (dueño de la operación) y staff (dueño de la existencia del barbero) mediante un puerto explícito, nunca acoplando el núcleo de un módulo al repositorio interno del otro. Sin columnas propias de negocio (CA-023-07): nunca nombre, duración, precio ni estado, que siguen siendo responsabilidad exclusiva de professional/service. DEC-068: un servicio ACTIVO debe conservar al menos una fila aquí; la aplicación (no esta tabla) rechaza la operación que lo dejaría en cero, dentro de una transacción que bloquea la fila de service para resistir la carrera de dos desasignaciones concurrentes.';
COMMENT ON TABLE whatsapp_conversation_window IS 'Última interacción entrante de cada teléfono con el número de WhatsApp de NAVA (DEC-126). Propietario funcional: plataforma. Retención: hasta expires_at (24 h después del último mensaje entrante, el límite de Meta para texto libre). Clasificación: dato personal seudonimizado; phone_hash es HMAC-SHA256 con el secreto de despliegue, nunca el teléfono. Sin business_id por diseño: el número emisor es único de la plataforma. RLS forzada con solo la política administrativa de barberia_owner.';
COMMENT ON TABLE whatsapp_message_status IS 'Estados de entrega que Meta notifica de los mensajes enviados por NAVA (DEC-126). Propietario funcional: plataforma. Retención: 30 días desde received_at. Clasificación: técnico. Solo guarda el identificador del mensaje (wamid), el estado y el código de error de Meta: ni teléfono ni contenido. La clave (wamid, status) hace idempotente la repetición de una notificación. Sin business_id por diseño; RLS forzada con solo la política administrativa de barberia_owner.';
COMMENT ON TABLE working_hour IS 'Tramo recurrente de la jornada laboral de un barbero, por día ISO de la semana (HU-040, F-HOR-01). Propietario funcional: barbería. Retención: mientras exista el barbero (working_hour_business_id_professional_id_fk usa ON DELETE RESTRICT, DEC-070). Clasificación: negocio. Varios tramos por barbero y día representan jornada partida.';
COMMENT ON COLUMN working_hour.starts_time IS 'Hora civil de inicio del tramo, interpretada junto con business.timezone; no se almacena un instante calculado (estandar-base-datos.md §5.5).';

-- 5. Vocabulario por defecto de un negocio nuevo (DEC-110, DEC-183)
ALTER TABLE business
  ALTER COLUMN business_term SET DEFAULT 'negocio',
  ALTER COLUMN business_term_gender SET DEFAULT 'masculine',
  ALTER COLUMN professional_term SET DEFAULT 'profesional',
  ALTER COLUMN professional_term_plural SET DEFAULT 'profesionales',
  ALTER COLUMN professional_term_gender SET DEFAULT 'masculine';
