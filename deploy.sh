#!/usr/bin/env sh
set -eu

docker compose pull || true
docker compose up -d --build
docker compose ps
