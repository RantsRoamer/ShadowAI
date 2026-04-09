# ShadowAI

Web-based AI assistant that connects to a local [Ollama](https://ollama.com) server. Matrix-style UI, configurable multi-model setup (Main Brain + agents), code execution, and self-update (edit project files with owner).

**Repository:** [https://github.com/RantsRoamer/ShadowAI](https://github.com/RantsRoamer/ShadowAI)

For ideas on extending ShadowAI (multi-channel messaging, voice, calendar, smart home, browser automation, vision, MCP), see [ROADMAP.md](ROADMAP.md).

## Features

- **Multi-channel** — Same AI from CLI, Telegram, Discord, and Matrix (Config → Channels; optional bots)
- **Password protected** — default login `admin` / `admin` (change in Config)
- **Multi-model** — Main Brain model + optional agents (e.g. Coding Agent) from same or different Ollama URLs
- **Config via UI** — Server bind address (default `0.0.0.0`), port (default `9090`), auth, Ollama URLs and models
- **Personality, memory & AI behavior** — `personality.md`, `memory.md`, and `AIBEHAVIOR.md` (who you are / how the AI should help) are injected into every chat (web, CLI, Telegram, Discord, Matrix).
- **Run code** — In chat: `/run js <code>` or `/run py <code>`
- **Self-update** — Read/write project files: `/read path`, `/write path` + content, `/list [path]` (allowed extensions: .js, .json, .html, .css, .md, .txt, .ts, .py, etc.)
- **Skills/plugins** — Ask the AI to build a skill; it creates `skills/<id>/skill.json` + `run.js`. Enable/disable and run from **SKILLS** with no server reload. Run in chat: `/skill <id> [JSON args]`
- **Heartbeat scheduler** — Cron-style jobs that run skills or prompts every X minutes/hours/days; jobs remember `lastRunAt` so missed runs while offline are caught up once on restart, and skill results can optionally be emailed.
- **Projects** — Isolated project-specific chats. Each project has its own memory (markdown); you can add notes, paste text, or import PDFs and images (PDF text extraction and image description via Ollama vision). The AI answers only from that project’s context and is not aware of other projects.
- **Project email reports** — Configure multiple named reports under PROJECTS (Email reports): choose projects, schedule (cron), recipient email, and a custom formatting prompt. Reports are run by the heartbeat scheduler, respect your configured timezone, and send a single combined email per report.
- **Knowledge index (RAG)** — Built‑in retrieval-augmented generation using Ollama embeddings and a local vector index in `data/vectors`. Upload PDFs/TXT/MD/DOC/DOCX or index project memory, then query via the KNOWLEDGE page, `/rag <query>`, or `#rag` in chat.
- **UI customization** — Change the application name, toggle tool‑call blocks and the prompt library button, and upload an AI avatar/profile picture used as the assistant’s chat avatar.
- **Mobile-friendly UI** — Chat, Projects, and other main pages include responsive layouts so the interface remains usable on phones and tablets.
- **Multi-user & roles** — SQLite-backed users (`data/users.db`) with `admin`, `user`, and `guest` roles. Each user has isolated chats and projects. Admins manage all users and global config from **SYSTEM → USERS**.
- **Project access control** — Projects can be shared with other users at three levels: **Admin** (full control), **User** (chat + edit memory), or **Read-only** (chat only). Access is enforced server-side on every request. Non-admins see only their own projects and those explicitly shared with them.

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

## Navigation

The top nav bar is organised as:

`DASHBOARD | CHAT | PROJECTS | SKILLS | KNOWLEDGE | SYSTEM ▾ | EDITOR`

The **SYSTEM** dropdown contains pages for system administration:

| Page | Description |
|------|-------------|
| CONFIG | Server, auth, Ollama, search, notifications, channels, UI, RAG |
| PERSONALITY | Personality, memory, AI behavior, structured memory |
| HEARTBEAT | Scheduled jobs and inbound webhooks |
| AGENTS | Additional Ollama models / agents |
| PIPELINES | Multi-step automation pipelines |
| USERS | User management and project access (admin only) |

## Config

- **Server**: Bind address (`0.0.0.0` = all interfaces) and port. Changes require restart.
- **Auth**: Username and password. Leave password blank to keep current.
- **Ollama — Main Brain**: Base URL (e.g. `http://localhost:11434`) and model name. Use "Fetch models" to list models from the server.
- **Agents**: Add agents (e.g. Coding Agent) with their own URL and model. Select the agent in the chat header to use it for that conversation.
- **Channels**: API key for the channel API (CLI/bots), and optional Telegram, Discord, and Matrix bots. **Restart the server** after changing channel settings.
- **UI**: Application name shown in the header and login, toggle for showing tool-call results in chat, toggle for the Prompt Library button, and upload/remove the AI’s avatar (profile picture).
- **RAG (Retrieval)**: Embedding model name (Ollama), chunk size and overlap, base collection name for the local index in `data/vectors`, and default Top‑K results to retrieve per query.

## Personality, memory & AI behavior

Open **PERSONALITY** in the nav to edit:

- **Personality** (`data/personality.md`): how the AI should generally behave (tone, style, constraints). Included in every system prompt.
- **Memory** (`data/memory.md`): free-form notes and facts the AI should remember long-term. The `append_memory` tool adds timestamped entries when you say “remember X”. Included in every system prompt so the AI can answer “who am I?” etc.
- **Structured memory** (`data/memory.json`): key–value / graph-like facts (e.g. `user:timezone`, `project:shadowai:status`). Exposed to the model via the `get_memory(key)` / `set_memory(key, value)` tools and injected into the system prompt as a short “recent facts” block that is shared across chats and channels.
- **AI Behavior** (`data/AIBEHAVIOR.md`): who you are and how the AI should help you (role, projects, important dates like your wedding). This is injected into every chat (web, CLI, Telegram, Discord, Matrix) so the assistant always has your context.

## Projects

Open **PROJECTS** to create and manage project-specific chats. Each project is isolated: the AI sees only that project’s memory and is not aware of other projects or global memory.

- **Create a project** — Click “New project”, name it, then open it.
- **Project memory** — Edit the memory text area (markdown). This is the only context the AI has for that project. Save with “Save memory”.
- **Import** — Paste text and click “Import text”, or upload a **PDF** (text is extracted) or an **image** (Ollama vision describes it and the description is added to memory). PDF import requires the optional dependency: `npm install pdf-parse`. Image import uses the configured Ollama model (set a vision-capable model like `llava` in Config → Ollama if needed).
- **Project chat** — Use the chat panel to ask questions about the project. Answers are based only on that project’s memory. You can clear the project chat with “Clear chat” without losing the project’s memory.

### Project access

Each project page has an **Access** section in the left sidebar. The project owner (or a global admin) can grant other users access at three levels:

| Level | Can chat | Edit memory & import files | Delete project / manage access |
|-------|----------|---------------------------|-------------------------------|
| Read-only | ✓ | — | — |
| User | ✓ | ✓ | — |
| Admin | ✓ | ✓ | ✓ |

- Type a username, select a role, and click **Add**.
- Click **×** next to a name to remove their access.
- Access is enforced server-side — users who are not the owner and have no share entry cannot read or write a project’s memory, import files, or access the project chat.

### Project email reports

- Open the **Email reports** tab under PROJECTS.
- Create multiple reports with:
  - **Name** and **enabled** toggle.
  - **Send to email** address.
  - **Schedule** (cron expression or presets like “Daily 08:00”; interpreted in your configured timezone).
  - **Included projects** (one or many).
  - **Format prompt** describing what to include and how to format (e.g. detailed budget overview, bullet action list, tables).
- Each report sends **one combined email** for its selected projects. You can also click **Send now** to run a report immediately.
- Reports are implemented as heartbeat jobs and track `lastRunAt` so they don’t double‑fire and recover cleanly after downtime.

Data is stored under `data/projects/<id>/` (project metadata and `memory.md`). Chat history for each project is stored like other synthetic users (e.g. `project_<id>`).

## Knowledge index (RAG)

Open **KNOWLEDGE** to manage the built‑in retrieval index.

- **Target** — Choose **Global** (shared across all chats) or **Project** (per‑project index).
- **Upload documents** — Upload PDF, TXT, MD, DOC, or DOCX. Text is extracted, chunked, embedded via the configured Ollama embedding model, and stored in a local JSON index under `data/vectors`.
- **Index project memory** — For project targets, you can index a project’s `memory.md` so RAG queries can use that long‑term project context.
- **Clear index** — Clear the global or selected project index if you want to start fresh or change chunking parameters.
- **In chat**:
  - `/rag <query>` — runs a retrieval query and shows the top‑k chunks as an assistant message.
  - `#rag <question>` — treat the message as a normal question, but prepend retrieved chunks into the model’s context so the answer uses that knowledge.

## Multi-channel messaging

Use the same AI from the **CLI**, **Telegram**, **Discord**, or **Matrix** (Synapse and other homeservers). Configure in **CONFIG → Channels** and restart the server for changes to take effect.

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

### Matrix (Synapse / homeserver) bot

1. On your homeserver, create a dedicated bot user (or use an existing account).
2. In Config → Channels, enable **Matrix bot** and set **Homeserver URL** to your client API base (e.g. `https://matrix.example.org`). Choose a **sign-in method**:
   - **Access token** — paste a token (e.g. from Element **Help & About → Access Token**). Easiest if you already have a token.
   - **Username and password (Client-Server login API)** — enter the bot’s Matrix user ID (local part or full `@user:server`) and password. On startup, ShadowAI calls `POST /_matrix/client/v3/login` (same API Element uses) and uses the returned access token for the session. The password is stored in `config.json` when you save; it is not returned in the config API response.
   - If **Access token** is selected but the token field is empty, ShadowAI will still try **user ID + password** from config when both are set (fallback).
3. Install the optional dependency: `npm install matrix-bot-sdk`
4. Restart the server after saving channel settings.
5. Invite the bot to a room or start a direct message. The bot auto-accepts invites. Each Matrix user gets their own conversation history (unencrypted rooms work out of the box; encrypted rooms require extra crypto setup and are not covered here).
6. **Restrict who can use the bot:** set **Allowed Matrix user IDs** to comma-separated full MXIDs (e.g. `@alice:example.org`). Leave empty to allow any user in rooms where the bot is present.
7. Send `reset` or `!reset` in the room to clear that user’s stored conversation (same idea as Discord `/reset`).

Channel conversations (CLI, Telegram, Discord, Matrix) are stored per synthetic user id (e.g. `channel_cli`, `telegram_<userId>`, `discord_<userId>`, `matrix_<localpart_homeserver>`) and appear in the web UI chat list so you can inspect or continue them from the browser. CLEAR in the web UI, or `/reset` in Discord / `reset` in Matrix, will clear that channel conversation.

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

## Multi-user setup

ShadowAI supports multiple users, each with isolated chats and project access controlled by role and explicit sharing.

### User roles

| Role | Description |
|------|-------------|
| `admin` | Full access: global config, all projects, user management |
| `user` | Own chats and projects; access to shared projects per their share level |
| `guest` | Same as user but intended for restricted or read-only access |

### Managing users (admin)

Open **SYSTEM → USERS** to:

- **Add a user** — fill in username, password, and role, then click **Save user**.
- **Edit a user** — click **Edit** on any row to load their details into the form, update, and save.
- **Delete a user** — click **Delete** (not available for the `admin` account).
- **Manage project access** — click **Projects** on any user row to open the access panel. Every project is listed with a dropdown (**None / Read-only / User / Admin**). Set each project's level and click **Save access**. Only changed projects are updated.

### Granting project access (project owner or admin)

Any user who owns a project (or has admin-level share access) can also manage access directly from the project page:

1. Open the project from **PROJECTS**.
2. In the left sidebar, find the **Access** section.
3. Enter a username, choose a role, and click **Add**.
4. Remove access with the **×** button next to a name.

### Data isolation

- Each user's chat history is stored separately and is never visible to other users.
- Project memory, imports, and project chat are only accessible to the project owner and users with an explicit share entry.
- All access checks are enforced server-side — bypassing the UI via direct API calls returns `403 Forbidden` for unauthorised requests.

## Security

- Users and roles are stored in a local SQLite database at `data/users.db`. On first start, the existing `config.auth` entry is migrated into the users table as the initial `admin`.
- Admins can create/update/delete users and assign roles from **SYSTEM → USERS** (or via `/api/users`).
- Only admins can change global config, email/notification settings, and user accounts.
- Project access (memory read/write, file import, project chat) is checked on every request against the project's `shares` list.
- Code execution runs in a sandbox under the `run/` folder with time and output limits.
- Self-update is limited to the project directory and allowed file extensions. X

## License

MIT
