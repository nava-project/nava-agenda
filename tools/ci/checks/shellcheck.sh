#!/usr/bin/env bash
# Parte del check "Despliegue (compose, scripts e imágenes)" del CI en Jenkins (DEC-177):
# Análisis con ShellCheck de los scripts de despliegue, respaldos y CI. Corre dentro de la imagen
# tools/ci/ci.Dockerfile; lo lanza tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
shellcheck --version | head -2
shellcheck -x -S warning \
  deploy/scripts/*.sh deploy/backup/*.sh deploy/docker/with-secrets.sh \
  deploy/db/entrypoint.sh deploy/db/init/*.sh \
  deploy/jenkins/scripts/*.sh tools/ci/*.sh tools/ci/checks/*.sh
