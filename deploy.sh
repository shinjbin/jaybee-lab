#!/usr/bin/env sh
set -eu

docker compose -f docker-compose.yml pull || true
docker compose -f docker-compose.yml up -d --build postgres backend frontend worker
docker compose -f docker-compose.yml up -d --force-recreate nginx cloudflared
docker compose -f docker-compose.yml ps