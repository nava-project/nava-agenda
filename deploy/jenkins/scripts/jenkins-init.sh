#!/usr/bin/env bash
# Prepara el Jenkins de la VPS (DEC-177). Corre en el servidor como root (sudo) y es
# idempotente: nunca sobrescribe un secreto existente.
#
#   sudo bash jenkins-init.sh
#
# Crea:
#   /srv/jenkins/home            JENKINS_HOME (UID 1000, el de la imagen de Jenkins)
#   /srv/jenkins/secrets/        un archivo por secreto (700/600, UID 1000):
#     ADMIN_PASSWORD             contraseña del usuario `admin` (aleatoria)
#     GITHUB_WEBHOOK_SECRET      secreto HMAC del webhook (aleatorio)
#     DEPLOY_SSH_KEY             llave para entrar como `deploy` (se genera aquí)
#     DEPLOY_KNOWN_HOSTS         huella SSH del host vista desde la red de Jenkins
#     GITHUB_TOKEN               vacío: se carga con jenkins-secret-set.sh
#     MAPS_BROWSER_KEY           vacío: se carga con jenkins-secret-set.sh
#   /srv/jenkins/stack.env       DOCKER_GID para compose
# y autoriza la llave en ~deploy/.ssh/authorized_keys, restringida a la red de Jenkins
# (10.89.10.0/24) y sin terminal ni reenvíos.
set -euo pipefail
umask 077

[ "$(id -u)" = 0 ] || { echo "ejecútalo con sudo" >&2; exit 1; }
base=/srv/jenkins
secrets="$base/secrets"
juid=1000
net=10.89.10.0/24
host_ip=10.89.10.1

install -d -o "$juid" -g "$juid" -m 750 "$base" "$base/home"
install -d -o "$juid" -g "$juid" -m 700 "$secrets"

put() { # <nombre>; valor por stdin; no sobrescribe
  local f="$secrets/$1"
  if [ -s "$f" ]; then cat >/dev/null; echo "= $1 ya existe"; return; fi
  cat >"$f"; chown "$juid:$juid" "$f"; chmod 600 "$f"; echo "+ $1"
}
openssl rand -base64 24 | tr -d '\n' | put ADMIN_PASSWORD
openssl rand -hex 32 | tr -d '\n' | put GITHUB_WEBHOOK_SECRET

if [ ! -s "$secrets/DEPLOY_SSH_KEY" ]; then
  tmp="$(mktemp -d)"
  ssh-keygen -q -t ed25519 -N '' -C "jenkins@nava-vps" -f "$tmp/key"
  put DEPLOY_SSH_KEY <"$tmp/key"
  rm -rf "$tmp"
fi
pub="$(ssh-keygen -y -f "$secrets/DEPLOY_SSH_KEY")"
auth=/home/deploy/.ssh/authorized_keys
if ! grep -qF "${pub#* }" "$auth"; then
  echo "restrict,from=\"$net\" $pub jenkins@nava-vps" >>"$auth"
  echo "+ llave de Jenkins autorizada para deploy (solo desde $net)"
fi
restorecon -q "$auth" 2>/dev/null || true

# Huella del host tal como la ve Jenkins (por la IP de su red); no es secreta.
printf '%s %s\n' "$host_ip" "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)" >"$secrets/DEPLOY_KNOWN_HOSTS"
chown "$juid:$juid" "$secrets/DEPLOY_KNOWN_HOSTS"; chmod 600 "$secrets/DEPLOY_KNOWN_HOSTS"

for name in GITHUB_TOKEN MAPS_BROWSER_KEY; do
  [ -e "$secrets/$name" ] || { : >"$secrets/$name"; chown "$juid:$juid" "$secrets/$name"; chmod 600 "$secrets/$name"; }
  [ -s "$secrets/$name" ] || echo "! falta $name: cárgalo con jenkins-secret-set.sh $name"
done

umask 022
echo "DOCKER_GID=$(getent group docker | cut -d: -f3)" >"$base/stack.env"
echo "Listo. Arranca con: sudo bash jenkins-up.sh"
