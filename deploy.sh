#!/usr/bin/env sh
set -eu

docker compose -f docker-compose.yml pull || true
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
