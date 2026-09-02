#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR_="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"

if [ ! -f "${ENV_FILE}" ]; then
    echo "Erro: copie ${SCRIPT_DIR}/.env.example para ${ENV_FILE} e configure STAPP_HOST_IP."
    exit 1
fi

echo "Iniciando LiveKit via Docker Compose..."
docker compose --file "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d

echo "Aguardando LiveKit responder em 7880..."
for i in {1..30}; do
    if curl -s -f http://127.0.0.1:7880/ > /dev/null 2>&1; then
        echo "LiveKit está pronto e saudâvel!"
        exit 0
    fi
    sleep 1
done

echo "Erro: LiveKit não respondeu dentro de 30 segundos."
exit 1
