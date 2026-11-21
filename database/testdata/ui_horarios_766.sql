-- Solo datos sintéticos para los E2E de Horarios y festivos (#766): horarios.spec.ts y
-- excepciones-festivos.spec.ts. Aplicar con rol migrador SOLO en la BD local de pruebas o
-- en CI; ningún despliegue carga database/testdata (deploy/ no lo referencia).
-- La contraseña ficticia, exclusiva de estas cuentas, es la constante de prueba de
-- apps/web/e2e/horarios-sesion.ts (E2E_HORARIOS_PASSWORD la sustituye). No reutilizarla.
-- Un profesional fijo por spec y proyecto de Playwright (escritorio y móvil corren en
-- paralelo y no deben pisarse); el negocio B solo sirve para el aislamiento (RN-TEN-01).
BEGIN;
INSERT INTO business (id,name,timezone) VALUES ('766a0001-0000-4000-8000-000000000001','Equipo de prueba horarios A','America/Bogota') ON CONFLICT (id) DO NOTHING;
INSERT INTO staff_user (id,business_id,email,full_name,is_active) VALUES ('766a0001-0000-4000-8000-000000000002','766a0001-0000-4000-8000-000000000001','horarios.766.1@ejemplo.test','Operador de prueba horarios A',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO staff_credential (staff_user_id,business_id,password_hash,password_algorithm) VALUES ('766a0001-0000-4000-8000-000000000002','766a0001-0000-4000-8000-000000000001','$argon2id$v=19$m=19456,t=2,p=1$+3ZN+lR2HM+hYTkgjWYq7w$VlcsDAJX8lRIKmXnMCrfvpeJFgGOJH9zY+LchqNLAn0','argon2id') ON CONFLICT (staff_user_id) DO NOTHING;
INSERT INTO professional (id,business_id,full_name) VALUES ('766b0001-0000-4000-8000-000000000001','766a0001-0000-4000-8000-000000000001','Horario de prueba escritorio') ON CONFLICT (id) DO NOTHING;
INSERT INTO professional (id,business_id,full_name) VALUES ('766b0001-0000-4000-8000-000000000002','766a0001-0000-4000-8000-000000000001','Horario de prueba móvil') ON CONFLICT (id) DO NOTHING;
INSERT INTO professional (id,business_id,full_name) VALUES ('766b0001-0000-4000-8000-000000000003','766a0001-0000-4000-8000-000000000001','Festivos de prueba escritorio') ON CONFLICT (id) DO NOTHING;
INSERT INTO professional (id,business_id,full_name) VALUES ('766b0001-0000-4000-8000-000000000004','766a0001-0000-4000-8000-000000000001','Festivos de prueba móvil') ON CONFLICT (id) DO NOTHING;
INSERT INTO business (id,name,timezone) VALUES ('766a0002-0000-4000-8000-000000000001','Equipo de prueba horarios B','America/Bogota') ON CONFLICT (id) DO NOTHING;
INSERT INTO staff_user (id,business_id,email,full_name,is_active) VALUES ('766a0002-0000-4000-8000-000000000002','766a0002-0000-4000-8000-000000000001','horarios.766.2@ejemplo.test','Operador de prueba horarios B',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO staff_credential (staff_user_id,business_id,password_hash,password_algorithm) VALUES ('766a0002-0000-4000-8000-000000000002','766a0002-0000-4000-8000-000000000001','$argon2id$v=19$m=19456,t=2,p=1$+3ZN+lR2HM+hYTkgjWYq7w$VlcsDAJX8lRIKmXnMCrfvpeJFgGOJH9zY+LchqNLAn0','argon2id') ON CONFLICT (staff_user_id) DO NOTHING;
INSERT INTO professional (id,business_id,full_name) VALUES ('766b0002-0000-4000-8000-000000000001','766a0002-0000-4000-8000-000000000001','Solo del negocio B') ON CONFLICT (id) DO NOTHING;
COMMIT;
