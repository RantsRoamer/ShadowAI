# ShadowAI

Web-based AI assistant that connects to a local [Ollama](https://ollama.com) server. Matrix-style UI, configurable multi-model setup (Main Brain + agents), code execution, and self-update (edit project files with owner).

## Features

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

## Config

- **Server**: Bind address (`0.0.0.0` = all interfaces) and port. Changes require restart.
- **Auth**: Username and password. Leave password blank to keep current.
- **Ollama — Main Brain**: Base URL (e.g. `http://localhost:11434`) and model name. Use "Fetch models" to list models from the server.
- **Agents**: Add agents (e.g. Coding Agent) with their own URL and model. Select the agent in the chat header to use it for that conversation.

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
