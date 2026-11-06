# syntax=docker/dockerfile:1
# PostgreSQL de NAVA. La misma imagen sirve para la base de datos y para el
# servicio de respaldos (cambia el comando): garantiza que `pg_dump` y el
# servidor tienen la misma versión mayor.
#   - openssl: genera el certificado TLS en el primer arranque (la API exige
#     sslmode distinto de `disable` fuera de local/test).
#   - rclone: copia externa opcional de los respaldos.
# Contexto de construcción: la raíz del repositorio.
ARG POSTGRES_VERSION=16
FROM postgres:${POSTGRES_VERSION}-alpine

# Usuario no privilegiado de los respaldos: el UID coincide con el de `deploy`
# en el VPS para que la carpeta de respaldos (bind mount) sea suya.
ARG BACKUP_UID=1001
RUN apk add --no-cache openssl rclone tzdata \
    && adduser -D -u ${BACKUP_UID} -h /home/backup backup

COPY deploy/db/postgresql.conf deploy/db/pg_hba.conf /etc/postgresql/
COPY deploy/db/init/ /docker-entrypoint-initdb.d/
COPY deploy/db/entrypoint.sh /usr/local/bin/nava-db-entrypoint.sh
COPY deploy/backup/backup.sh deploy/backup/restore-test.sh deploy/backup/scheduler.sh /usr/local/bin/
RUN chmod 0555 /usr/local/bin/nava-db-entrypoint.sh /usr/local/bin/backup.sh /usr/local/bin/restore-test.sh /usr/local/bin/scheduler.sh \
    && chmod 0555 /docker-entrypoint-initdb.d/*.sh

ENTRYPOINT ["nava-db-entrypoint.sh"]
CMD ["postgres"]
