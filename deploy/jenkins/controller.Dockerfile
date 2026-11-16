# Controlador de Jenkins de la VPS (DEC-177). Contexto de construcción: deploy/jenkins.
#
# Añade a la imagen oficial lo que usan los pipelines: el cliente de Docker (con compose
# y buildx) para hablar con el Docker del host, git, ssh, jq y curl. Los plugins y la
# configuración como código (casc/) quedan dentro de la imagen: cambiarlos es cambiar
# el repositorio y reconstruir (scripts/jenkins-up.sh), nunca tocar la interfaz.
FROM jenkins/jenkins:2.580.2-lts-jdk21

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg jq openssh-client \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
       >/etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/* \
    && docker --version && docker compose version && docker buildx version
USER jenkins

COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY --chown=jenkins:jenkins casc/ /usr/share/jenkins/casc/

ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/casc \
    JENKINS_HOME=/srv/jenkins/home
