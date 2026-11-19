#!/bin/sh
# Genera /tmp/definitions.json a partir de la plantilla, usando el usuario y la
# contraseña de .env. Es necesario porque, cuando RabbitMQ importa definiciones
# al arrancar, ya no crea el usuario por defecto (RABBITMQ_DEFAULT_USER/PASS).
set -e
sed -e "s|__RABBITMQ_USER__|${RABBITMQ_DEFAULT_USER}|g" \
    -e "s|__RABBITMQ_PASS__|${RABBITMQ_DEFAULT_PASS}|g" \
    /etc/rabbitmq/definitions.template.json > /tmp/definitions.json
chmod 644 /tmp/definitions.json
exec docker-entrypoint.sh "$@"
