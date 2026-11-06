#!/bin/sh
# Cargador de secretos de Docker: exporta cada archivo de /run/secrets/<NOMBRE>
# como la variable de entorno NOMBRE y cede el control al comando indicado.
#
# La aplicación lee su configuración del entorno y no se modifica para soportar
# archivos; este cargador es el mismo mecanismo `*_FILE` de la imagen oficial de
# PostgreSQL, generalizado. Los secretos viven como archivos (modo 600, montados
# solo en lectura y solo en el servicio que los necesita) y no aparecen en la
# definición del contenedor (`docker inspect`) ni en ningún env_file.
#
# Un archivo vacío se omite: así un secreto opcional sin valor equivale a no estar.
set -eu
dir="${SECRETS_DIR:-/run/secrets}"
if [ -d "$dir" ]; then
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    name="${f##*/}"
    case "$name" in
      [A-Za-z_]*) ;;
      *) echo "with-secrets: nombre de secreto inválido: $name" >&2; exit 1 ;;
    esac
    case "$name" in
      *[!A-Za-z0-9_]*) echo "with-secrets: nombre de secreto inválido: $name" >&2; exit 1 ;;
    esac
    value="$(cat "$f")"
    [ -n "$value" ] || continue
    export "$name=$value"
  done
fi
exec "$@"
