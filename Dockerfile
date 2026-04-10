FROM node:22-bookworm-slim

# Python is needed for /run py code execution.
# We use a Debian/glibc image so optional Matrix deps (crypto backend) can install reliably.
# tzdata ensures the container can use a real timezone database. When you
# mount /etc/localtime (and optionally /etc/timezone) from the host or set
# TZ=... at runtime, the container's local time will match the host.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer-cached — only rebuilds when package.json changes).
# Include optionalDependencies so channel bots (Telegram/Discord/Matrix) are available in Docker.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --include=optional

# Copy source (config.json and data/ are excluded via .dockerignore)
COPY . .

# Create runtime directories
RUN mkdir -p data/chats run

# Strip Windows CRLF line endings and make entrypoint executable
RUN sed -i 's/\r//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

EXPOSE 9090

ENTRYPOINT ["/app/docker-entrypoint.sh"]
