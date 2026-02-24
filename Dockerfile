FROM node:20-alpine

# Python is needed for /run py code execution
RUN apk add --no-cache python3

WORKDIR /app

# Install dependencies first (layer-cached — only rebuilds when package.json changes)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source (config.json and data/ are excluded via .dockerignore)
COPY . .

# Create runtime directories
RUN mkdir -p data/chats run

# Strip Windows CRLF line endings and make entrypoint executable
RUN sed -i 's/\r//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

EXPOSE 9090

ENTRYPOINT ["/app/docker-entrypoint.sh"]
