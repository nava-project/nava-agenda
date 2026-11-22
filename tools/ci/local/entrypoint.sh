#!/bin/sh
# Arranca Jenkins como el usuario jenkins (UID 1000, igual que los contenedores de los
# checks) con acceso al socket de Docker montado. El grupo del socket depende de la
# instalación (Docker en Linux, rootless o Docker Desktop), así que se lee aquí dentro.
set -eu
sock=/var/run/docker.sock
[ -S "$sock" ] || { echo "Falta el socket de Docker en $sock" >&2; exit 1; }
gid="$(stat -c %g "$sock")"
getent group "$gid" >/dev/null || groupadd -g "$gid" docker-host
exec setpriv --reuid=1000 --regid=1000 --groups="$gid" \
  /usr/bin/tini -- /usr/local/bin/jenkins.sh "$@"
