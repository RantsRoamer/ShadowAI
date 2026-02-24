# ShadowAI

Web-based AI assistant that connects to a local [Ollama](https://ollama.com) server. Matrix-style UI, configurable multi-model setup (Main Brain + agents), code execution, and self-update (edit project files with owner).

**Repository:** [https://github.com/RantsRoamer/ShadowAI](https://github.com/RantsRoamer/ShadowAI)

For ideas on extending ShadowAI (multi-channel messaging, voice, calendar, smart home, browser automation, vision, MCP), see [ROADMAP.md](ROADMAP.md).

## Features

- **Multi-channel** — Same AI from CLI, Telegram, and Discord (Config → Channels; optional bots)
- **Password protected** — default login `admin` / `admin` (change in Config)
- **Multi-model** — Main Brain model + optional agents (e.g. Coding Agent) from same or different Ollama URLs
- **Config via UI** — Server bind address (default `0.0.0.0`), port (default `9090`), auth, Ollama URLs and models
- **Run code** — In chat: `/run js <code>` or `/run py <code>`
- **Self-update** — Read/write project files: `/read path`, `/write path` + content, `/list [path]` (allowed extensions: .js, .json, .html, .css, .md, .txt, .ts, .py, etc.)
- **Skills/plugins** — Ask the AI to build a skill; it creates `skills/<id>/skill.json` + `run.js`. Enable/disable and run from **SKILLS** with no server reload. Run in chat: `/skill <id> [JSON args]`

## Requirements

- Node.js 18+
- Ollama running locally (or on another host; set URL in Config)

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:9090** (or the host/port you set). Log in with `admin` / `admin`, then go to **CONFIG** to set your Ollama URL and models.

## Docker

Requires [Docker](https://docs.docker.com/get-docker/) and an Ollama instance (on the host or elsewhere).

### Build and run with Docker Compose

From the project root:

```bash
git clone https://github.com/RantsRoamer/ShadowAI.git
cd ShadowAI
docker compose up -d --build
```

Open **http://localhost:9090**. The first time, set `ADMIN_PASSWORD` in the environment (see below) or change the password in **CONFIG** after logging in with `admin` / `admin`.

### Install / update script (`install.sh`)

To shut down the running containers, pull the latest code from the repo, and rebuild and restart:

```bash
cd ShadowAI
chmod +x install.sh   # only needed once
./install.sh
```

You can run `./install.sh` from the project root, or from any directory (the script changes into its own directory first). Your data (config, chats) in the Docker volume is preserved.

### Build and run with Docker only

```bash
git clone https://github.com/RantsRoamer/ShadowAI.git
cd ShadowAI
docker build -t shadowai:latest .
docker run -d --name shadowai -p 9090:9090 \
  -v shadowai-data:/app/data \
  -e OLLAMA_URL=http://host.docker.internal:11434 \
  -e OLLAMA_MODEL=llama3.2 \
  shadowai:latest
```

Use a [named volume](https://docs.docker.com/storage/volumes/) or bind mount for `/app/data` so config and chat data persist.

### Ollama URL from inside the container

- **Docker Desktop (Mac/Windows):** use `http://host.docker.internal:11434` so the container can reach Ollama on the host.
- **Linux:** use the host’s gateway IP (e.g. `http://172.17.0.1:11434`) or your machine’s LAN IP. The sample `docker-compose.yml` adds `host.docker.internal:host-gateway` so the same URL works when supported.

### Docker environment variables

Configure via environment variables (applied at startup by `docker-init.js`):

| Variable | Description |
|----------|-------------|
| `OLLAMA_URL` | Ollama server URL (e.g. `http://host.docker.internal:11434`) |
| `OLLAMA_MODEL` | Default model name (e.g. `llama3.2`) |
| `ADMIN_USER` | Login username (default: `admin`) |
| `ADMIN_PASSWORD` | Login password (plain text; stored hashed). If set, overrides the password on every start — remove after first run to manage via Config. |
| `SEARXNG_URL` | SearXNG base URL to enable web search |
| `SEARXNG_ENABLED` | Set to `false` to disable web search even if `SEARXNG_URL` is set |
| `PORT` | HTTP port (default: `9090`) |
| `HOST` | Bind address (default: `0.0.0.0`) |

Config, chat history, and personality data are stored in the `/app/data` volume so they persist across container restarts.

## Config

- **Server**: Bind address (`0.0.0.0` = all interfaces) and port. Changes require restart.
- **Auth**: Username and password. Leave password blank to keep current.
- **Ollama — Main Brain**: Base URL (e.g. `http://localhost:11434`) and model name. Use "Fetch models" to list models from the server.
- **Agents**: Add agents (e.g. Coding Agent) with their own URL and model. Select the agent in the chat header to use it for that conversation.
- **Channels**: API key for the channel API (CLI/bots), and optional Telegram and Discord bots. **Restart the server** after changing channel settings.

## Multi-channel messaging

Use the same AI from the **CLI**, **Telegram**, and **Discord**. Configure in **CONFIG → Channels** and restart the server for changes to take effect.

### API key

Set an **API key** in Config → Channels. It is required for the channel API and is not used by the web UI. Keep it secret.

### CLI

Send a message and get a reply from the running ShadowAI server:

```bash
# Set env (use the same value as in Config → Channels)
export SHADOWAI_API_KEY=your-api-key
export SHADOWAI_URL=http://localhost:9090   # optional; default is http://localhost:9090

# From arguments
node scripts/cli.js "Hello, what can you do?"
# or
npm run cli -- "Hello"

# From stdin
echo "Summarize the last three messages" | node scripts/cli.js
```

### Telegram bot

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the bot token.
2. In Config → Channels, enable **Telegram** and paste the token. Restart the server.
3. Install the optional dependency: `npm install node-telegram-bot-api`
4. Start a chat with your bot in Telegram; each user gets their own conversation history.

### Discord bot

1. In [Discord Developer Portal](https://discord.com/developers/applications), create an application and add a bot. Copy the bot token. Under **Bot**, enable **MESSAGE CONTENT INTENT** (required to read messages).
2. In Config → Channels, enable **Discord** and paste the token. Restart the server.
3. Install the optional dependency: `npm install discord.js`
4. Invite the bot to your server (OAuth2 → URL Generator, scopes: bot, permissions: Send Messages, Read Message History, etc.). Each user gets their own conversation history.

## Skills / plugins

- **Create**: In Chat, ask the AI to build a skill (e.g. “Create a skill that returns the current time”). It will add `skills/<id>/skill.json` and `skills/<id>/run.js`. Skill IDs use only letters, numbers, hyphen and underscore.
- **Manage**: Open **SKILLS** to see all skills, enable/disable (no restart), run with optional JSON args, or delete.
- **Run in chat**: `/skill <id>` or `/skill <id> {"key":"value"}`.
- **Format**: `skill.json` has `name`, `description`, `enabled`. `run.js` must export `async function run(args) { return result; }` or `module.exports = { run }`.

## Security

- Default password is stored in plain text in `config.json`. For production, use a strong password and consider hashing (e.g. bcrypt) in `lib/auth.js`.
- Code execution runs in a sandbox under the `run/` folder with time and output limits.
- Self-update is limited to the project directory and allowed file extensions.

## License

MIT
