#!/bin/sh
# Genera el certificado TLS de PostgreSQL en cada arranque del contenedor y cede
# el control al entrypoint oficial. Debe existir ANTES de que arranque el servidor
# (incluido el temporal de la inicialización), porque la configuración exige ssl=on.
#
# Certificado autofirmado en un tmpfs (/run/nava-tls): la clave privada no se
# hornea en la imagen ni se guarda en el volumen de datos. La base solo es
# alcanzable desde la red interna de Docker; el cifrado protege el tráfico entre
# contenedores y satisface la validación del API (`sslmode=require`), que no exige
# verificar la CA.
set -eu
dir=/run/nava-tls
mkdir -p "$dir"
openssl req -new -x509 -days 3650 -nodes -newkey rsa:3072 \
  -subj "/CN=db" -addext "subjectAltName=DNS:db,DNS:localhost" \
  -keyout "$dir/server.key" -out "$dir/server.crt" 2>/dev/null
chown postgres:postgres "$dir/server.key" "$dir/server.crt"
chmod 0600 "$dir/server.key"
chmod 0644 "$dir/server.crt"
exec docker-entrypoint.sh "$@"
