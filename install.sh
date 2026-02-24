#!/usr/bin/env bash
# ShadowAI Docker update: stop containers, pull latest code, rebuild and restart.
# Run from the project root, or from anywhere (script will cd to its directory).
# Usage: ./install.sh   or   bash install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[install] Stopping Docker containers..."
docker compose down

echo "[install] Pulling latest from repository..."
git pull

echo "[install] Rebuilding and starting Docker..."
docker compose up -d --build

echo "[install] Done. ShadowAI should be available at http://localhost:9090"
