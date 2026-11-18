#!/usr/bin/env bash
# Fases del pipeline barberia/deploy (deploy/jenkins/pipelines/deploy.Jenkinsfile, DEC-177).
# Corre en el controlador de Jenkins, desde un checkout del último main. El estado entre
# fases vive en .release/ del workspace.
#
#   release.sh verify        resuelve el SHA, exige que sea de main y que su CI esté en
#                            verde; con AUTO=true omite el despliegue si main ya avanzó
#   release.sh images        worktree en el SHA y construcción de las imágenes que falten
#   release.sh deploy        envía la versión al servidor y ejecuta deploy.sh como `deploy`
#   release.sh public-check  GET $PUBLIC_URL/health
#
# Entorno: SHA y AUTO (parámetros), GITHUB_REPO y PUBLIC_URL (globales de Jenkins),
# GH_TOKEN, SSH_KEY y VITE_GOOGLE_MAPS_BROWSER_KEY (credenciales, según la fase).
set -euo pipefail

state=.release
deploy_host="${DEPLOY_HOST:-10.89.10.1}"
known_hosts=/run/secrets/DEPLOY_KNOWN_HOSTS
phase="${1:?uso: release.sh verify|images|deploy|public-check}"

fail() { echo "ERROR: $*" >&2; exit 1; }
get() { cat "$state/$1"; }

# Estado del CI de un commit en GitHub: el de Jenkins (continuous-integration/jenkins/branch).
# Los commits anteriores a la migración no se aceptan: sus check runs de GitHub Actions se
# borraron al retirarlo (#634).
ci_green() {
  local api="https://api.github.com/repos/$GITHUB_REPO/commits/$1/status"
  local jenkins
  jenkins="$(curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$api" \
    | jq -r '[.statuses[] | select(.context == "continuous-integration/jenkins/branch")][0].state // ""')"
  [ "$jenkins" = success ]
}

case "$phase" in
  verify)
    rm -rf "$state"; mkdir -p "$state"
    # Jenkins solo da credenciales a su propio checkout: aquí se pasan con un helper que lee
    # GH_USER/GH_TOKEN del entorno (el token no aparece en la línea de comandos).
    # shellcheck disable=SC2016
    git -c credential.helper= \
        -c 'credential.helper=!f() { echo "username=$GH_USER"; echo "password=$GH_TOKEN"; }; f' \
        fetch --no-tags --quiet origin +refs/heads/main:refs/remotes/origin/main
    tip="$(git rev-parse origin/main)"
    sha="$(git rev-parse --verify "${SHA:-$tip}^{commit}")" || fail "no existe el commit ${SHA:-}"
    git merge-base --is-ancestor "$sha" origin/main || fail "$sha no pertenece a main"
    echo "$sha" >"$state/sha"

    # Si ya hay un commit más nuevo en main, su propio CI disparará su despliegue: este se
    # omite para no desplegar una versión vieja encima de una nueva.
    if [ "${AUTO:-false}" = true ] && [ "$sha" != "$tip" ]; then
      touch "$state/skip"
      echo "omitido ${sha:0:12}: main avanzó a ${tip:0:12}" | tee "$state/summary"
      exit 0
    fi
    # AUTO=true solo lo pone el CI de main al terminar en verde, antes de que GitHub reciba
    # su estado final; a mano siempre se consulta GitHub.
    if [ "${AUTO:-false}" != true ]; then
      ci_green "$sha" || fail "el CI de $sha no está en verde: no se despliega"
    fi
    echo "${sha:0:12}$([ "${AUTO:-false}" = true ] && echo ' (automático)' || echo ' (manual)')" | tee "$state/summary"
    ;;

  images)
    sha="$(get sha)"
    git worktree remove --force "$state/src" 2>/dev/null || true
    git worktree prune
    git worktree add --detach "$state/src" "$sha"
    tools/ci/build-images.sh release "$state/src" "$sha"
    ;;

  deploy)
    sha="$(get sha)"
    # shellcheck disable=SC1091
    . "$state/src/.nava-release"   # DB_TAG
    [[ "$DB_TAG" =~ ^[0-9a-f]{12}$ ]] || fail "DB_TAG inválido: $DB_TAG"
    ssh_opts=(-i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts")
    # Solo lo necesario: compose, scripts, migraciones y el renombrado de roles que aplica
    # deploy.sh (DEC-183), del mismo commit que probó el CI.
    # SHA y DB_TAG se expanden aquí, en el cliente, a propósito (son hexadecimales).
    # shellcheck disable=SC2029
    tar -C "$state/src" -czf - deploy database/atlas.hcl database/migrations database/roles \
      | ssh "${ssh_opts[@]}" "deploy@$deploy_host" \
          "set -e; d=/srv/barberia/releases/$sha; rm -rf \"\$d\"; mkdir -p \"\$d\"; tar xzpf - -C \"\$d\""
    # Las imágenes ya están en el Docker del host (las construyó este Jenkins). --no-pull no
    # hace nada en el deploy.sh actual, pero el de versiones anteriores a #634 descargaría.
    # shellcheck disable=SC2029
    ssh "${ssh_opts[@]}" "deploy@$deploy_host" \
      "DEPLOY_ACTOR='jenkins:${BUILD_TAG:-manual}' bash /srv/barberia/releases/$sha/deploy/scripts/deploy.sh $sha --db-tag $DB_TAG --no-pull" </dev/null
    ;;

  public-check)
    [ -n "${PUBLIC_URL:-}" ] || { echo "PUBLIC_URL vacío: se omite"; exit 0; }
    for _ in 1 2 3 4 5 6; do
      curl -fsS --max-time 10 "$PUBLIC_URL/health" && { echo; exit 0; }
      sleep 10
    done
    fail "$PUBLIC_URL/health no responde"
    ;;

  *) fail "fase desconocida: $phase" ;;
esac
