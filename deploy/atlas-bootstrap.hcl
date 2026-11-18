# Configuración de Atlas SOLO para el bootstrap de un ambiente nuevo.
#
# docs/05-backend/migraciones-atlas.md §6 (DEC-040): las tres primeras migraciones
# (20260807170000, 20260807170100, 20260811145252) exigen CREATEROLE y se aplican
# con el administrador; el resto, con `agenda_migrator` (`barberia_migrator` antes de DEC-183; ambiente "production"
# de database/atlas.hcl). La URL llega por variable de entorno desde migrate.env:
# la imagen de Atlas no trae shell, y así la contraseña no aparece en los
# argumentos del proceso.
env "bootstrap" {
  url = getenv("DATABASE_ADMIN_URL")

  migration {
    dir = "file://migrations"
  }
}
