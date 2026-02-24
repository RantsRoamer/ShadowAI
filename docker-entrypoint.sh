#!/bin/sh
set -e

echo "[entrypoint] Starting ShadowAI..."

# Ensure runtime directories exist (in case the volume was freshly mounted)
mkdir -p /app/data/chats /app/run

# -------------------------------------------------------------------------
# config.json lives inside the data volume so it persists across container
# recreations (docker-compose down/up). We symlink /app/config.json to it.
# -------------------------------------------------------------------------
DATA_CONFIG="/app/data/config.json"
APP_CONFIG="/app/config.json"

if [ ! -f "$DATA_CONFIG" ]; then
  echo "[entrypoint] Initialising config.json from defaults..."
  cp /app/config.default.json "$DATA_CONFIG"
fi

# If a real (non-symlink) file exists at /app/config.json, migrate it
if [ -f "$APP_CONFIG" ] && [ ! -L "$APP_CONFIG" ]; then
  echo "[entrypoint] Migrating existing config.json into data volume..."
  cp "$APP_CONFIG" "$DATA_CONFIG"
  rm "$APP_CONFIG"
fi

# Create symlink so server.js finds config.json at the expected path
if [ ! -L "$APP_CONFIG" ]; then
  ln -s "$DATA_CONFIG" "$APP_CONFIG"
fi

# Apply any environment variable overrides (OLLAMA_URL, ADMIN_PASSWORD, etc.)
node /app/docker-init.js

exec node server.js
