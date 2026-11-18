-- Renombra los roles barberia_* a agenda_* (issue #660, DEC-183).
--
-- Lo ejecuta el SUPERUSUARIO (no Atlas): el rol que migra no puede renombrarse
-- a sí mismo y no tiene CREATEROLE. Va justo después de la migración
-- 20261121090000_rename_to_business_professional.sql y antes de cualquier
-- migración posterior, que ya nombra agenda_*: en una base nueva, las
-- migraciones anteriores crean y nombran barberia_*; este paso los renombra; las
-- siguientes encuentran agenda_*. Ver docs/05-backend/migraciones-atlas.md.
--
-- Es idempotente: un rol que ya no existe con el nombre viejo se salta. Los
-- privilegios, membresías, dueños y políticas siguen al rol (se guardan por
-- OID). Las contraseñas SCRAM se conservan; una MD5 se borraría al renombrar,
-- así que se rechaza antes de tocar nada.
--
-- El rol no puede tener una sesión abierta con el nombre viejo que dependa de
-- reconectarse: tras renombrar, las cadenas de conexión deben usar agenda_*.

DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_authid
    WHERE rolname IN ('barberia_app', 'barberia_worker', 'barberia_migrator', 'barberia_backup')
      AND rolpassword LIKE 'md5%'
  ) THEN
    RAISE EXCEPTION 'un rol barberia_* tiene contraseña MD5: renombrarlo la borraría. Cámbiala a SCRAM primero.';
  END IF;

  FOR r IN
    SELECT old_name, new_name FROM (VALUES
      ('barberia_owner', 'agenda_owner'),
      ('barberia_migrator', 'agenda_migrator'),
      ('barberia_app', 'agenda_app'),
      ('barberia_worker', 'agenda_worker'),
      ('barberia_backup', 'agenda_backup')
    ) AS t(old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.old_name) THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.new_name) THEN
        RAISE EXCEPTION 'existen % y % a la vez: revisar a mano', r.old_name, r.new_name;
      END IF;
      EXECUTE format('ALTER ROLE %I RENAME TO %I', r.old_name, r.new_name);
      RAISE NOTICE 'rol % renombrado a %', r.old_name, r.new_name;
    END IF;
  END LOOP;
END
$$;
