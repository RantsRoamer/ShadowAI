# ShadowAI

Web-based AI assistant that connects to a local [Ollama](https://ollama.com) server. Matrix-style UI, configurable multi-model setup (Main Brain + agents), code execution, and self-update (edit project files with owner).

**Repository:** [https://github.com/RantsRoamer/ShadowAI](https://github.com/RantsRoamer/ShadowAI)

For ideas on extending ShadowAI (multi-channel messaging, voice, calendar, smart home, browser automation, vision, MCP), see [ROADMAP.md](ROADMAP.md).

## Features

- **Multi-channel** — Same AI from CLI, Telegram, and Discord (Config → Channels; optional bots)
- **Password protected** — default login `admin` / `admin` (change in Config)
- **Multi-model** — Main Brain model + optional agents (e.g. Coding Agent) from same or different Ollama URLs
- **Config via UI** — Server bind address (default `0.0.0.0`), port (default `9090`), auth, Ollama URLs and models
- **Personality, memory & AI behavior** — `personality.md`, `memory.md`, and `AIBEHAVIOR.md` (who you are / how the AI should help) are injected into every chat (web, CLI, Telegram, Discord).
- **Run code** — In chat: `/run js <code>` or `/run py <code>`
- **Self-update** — Read/write project files: `/read path`, `/write path` + content, `/list [path]` (allowed extensions: .js, .json, .html, .css, .md, .txt, .ts, .py, etc.)
- **Skills/plugins** — Ask the AI to build a skill; it creates `skills/<id>/skill.json` + `run.js`. Enable/disable and run from **SKILLS** with no server reload. Run in chat: `/skill <id> [JSON args]`
- **Heartbeat scheduler** — Cron-style jobs that run skills or prompts every X minutes/hours/days; jobs remember `lastRunAt` so missed runs while offline are caught up once on restart, and skill results can optionally be emailed.
- **Projects** — Isolated project-specific chats. Each project has its own memory (markdown); you can add notes, paste text, or import PDFs and images (PDF text extraction and image description via Ollama vision). The AI answers only from that project’s context and is not aware of other projects.

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
  # (Linux) share host timezone with container so local time matches host
  -v /etc/localtime:/etc/localtime:ro \
  -v /etc/timezone:/etc/timezone:ro \
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
| `TZ` | Optional container timezone (e.g. `America/New_York`). When set, Node and cron use this timezone; on Linux you can also mount `/etc/localtime` and `/etc/timezone` so the container inherits the host time directly. |

Config, chat history, and personality data are stored in the `/app/data` volume so they persist across container restarts.

## Config

- **Server**: Bind address (`0.0.0.0` = all interfaces) and port. Changes require restart.
- **Auth**: Username and password. Leave password blank to keep current.
- **Ollama — Main Brain**: Base URL (e.g. `http://localhost:11434`) and model name. Use "Fetch models" to list models from the server.
- **Agents**: Add agents (e.g. Coding Agent) with their own URL and model. Select the agent in the chat header to use it for that conversation.
- **Channels**: API key for the channel API (CLI/bots), and optional Telegram and Discord bots. **Restart the server** after changing channel settings.

## Personality, memory & AI behavior

Open **PERSONALITY** in the nav to edit:

- **Personality** (`data/personality.md`): how the AI should generally behave (tone, style, constraints). Included in every system prompt.
- **Memory** (`data/memory.md`): free-form notes and facts the AI should remember long-term. The `append_memory` tool adds timestamped entries when you say “remember X”. Included in every system prompt so the AI can answer “who am I?” etc.
- **Structured memory** (`data/memory.json`): key–value / graph-like facts (e.g. `user:timezone`, `project:shadowai:status`). Exposed to the model via the `get_memory(key)` / `set_memory(key, value)` tools and injected into the system prompt as a short “recent facts” block that is shared across chats and channels.
- **AI Behavior** (`data/AIBEHAVIOR.md`): who you are and how the AI should help you (role, projects, important dates like your wedding). This is injected into every chat (web, CLI, Telegram, Discord) so the assistant always has your context.

## Projects

Open **PROJECTS** to create and manage project-specific chats. Each project is isolated: the AI sees only that project’s memory and is not aware of other projects or global memory.

- **Create a project** — Click “New project”, name it, then open it.
- **Project memory** — Edit the memory text area (markdown). This is the only context the AI has for that project. Save with “Save memory”.
- **Import** — Paste text and click “Import text”, or upload a **PDF** (text is extracted) or an **image** (Ollama vision describes it and the description is added to memory). PDF import requires the optional dependency: `npm install pdf-parse`. Image import uses the configured Ollama model (set a vision-capable model like `llava` in Config → Ollama if needed).
- **Project chat** — Use the chat panel to ask questions about the project. Answers are based only on that project’s memory. You can clear the project chat with “Clear chat” without losing the project’s memory.

Data is stored under `data/projects/<id>/` (project metadata and `memory.md`). Chat history for each project is stored like other synthetic users (e.g. `project_<id>`).

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
5. **Restrict who can use the bot:** set **Allowed Discord user IDs** to a comma-separated list of Discord user IDs (e.g. `123456789012345678`). Leave empty to allow everyone. Enable Developer Mode in Discord (User Settings → App Settings) then right-click a user → Copy user ID.
6. The bot supports typing indicators while it’s generating a reply, and a `/reset` (slash command or text) to clear that user’s conversation.

Channel conversations (CLI, Telegram, Discord) are stored per synthetic user id (e.g. `channel_cli`, `telegram_<userId>`, `discord_<userId>`) and appear in the web UI chat list so you can inspect or continue them from the browser. CLEAR in the web UI, or `/reset` in Discord, will clear that channel conversation.

## Heartbeat (scheduled tasks)

Open **HEARTBEAT** to schedule the AI or a skill to run at set times:

- **Jobs**: each job has an id, name, cron schedule (minute hour day month weekday), type (`skill` or `prompt`), and optional JSON args when calling a skill.
- **Scheduler**: runs every **30 seconds**, evaluates cron for each job, and runs due jobs. `lastRunAt` is persisted per job so if the server was offline during a scheduled time, the job runs once on restart to catch up.
- **Skill jobs + email**: for `type: skill`, you can enable **Email result**. When on, the skill’s return value (string or `{ subject, text }`) is emailed to the configured default address using the **Notifications** email config.
- **Presets**: quick cron presets like “Every 5 min”, “Daily 07:00”, etc.
- **Run now**: test a job immediately with **Run now** before relying on the schedule.

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
