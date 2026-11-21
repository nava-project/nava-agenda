# Jenkins LOCAL de evaluación (DEC-177): el mismo controlador que la VPS
# (nava-project/nava-jenkins/controller.Dockerfile), sin nada de producción.
#
# Añade a la imagen oficial el cliente de Docker (con buildx) para hablar con el Docker
# del host, que es donde corren los checks (tools/ci/run.sh) y se construyen las imágenes.
FROM jenkins/jenkins:2.580.2-lts-jdk21

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg jq \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
       >/etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/* \
    && docker --version && docker compose version && docker buildx version \
    # La copia clonada se monta en /repo con el dueño del host (otro UID): git la acepta.
    && git config --system --add safe.directory '*'
USER jenkins

COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY --chown=jenkins:jenkins casc/ /usr/share/jenkins/casc/
COPY entrypoint.sh /usr/local/bin/nava-entrypoint.sh

ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/casc/jenkins.yaml
# Arranca como root solo para leer el grupo del socket de Docker; Jenkins corre como jenkins.
USER root
ENTRYPOINT ["/usr/local/bin/nava-entrypoint.sh"]
