# ShadowAI roadmap: capabilities and extensions

This document lists features that would expand ShadowAI: persistent memory, multi-channel messaging, real automation, and richer tooling — while staying self-hosted and Ollama-first.

---

## What ShadowAI already has

| Area | ShadowAI today |
|------|----------------|
| **Chat** | Web UI, multi-model (Main Brain + agents), streaming, regenerate, copy, export |
| **Memory** | `memory.md` + `append_memory` tool; personality; per-chat custom instructions |
| **Search** | SearXNG web search + `fetch_url` for reading pages |
| **Email** | Send email (with default To); configurable SMTP |
| **Automation** | Heartbeat (scheduled tasks with conditions) |
| **Skills** | Create/manage/run skills (plugins); run in chat via `/skill <id>` |
| **Code** | `/run js` / `/run py` in chat; sandboxed execution |
| **Files** | `/read`, `/write`, `/list` for project files (self-update) |
| **Deployment** | Docker, install script, config UI |

---

## Gaps — what we could add

### 1. **Multi-channel messaging** (high impact, high effort)

Same AI on WhatsApp, Telegram, Discord, CLI.

- **Telegram bot** — Long-polling or webhook; same backend, new route that turns messages into chat turns and streams replies. Reuse existing auth or use bot token.
- **Discord bot** — Slash commands or DMs; same idea: message → history → Ollama → reply.
- **WhatsApp** — Often via Twilio/WhatsApp Business API or unofficial bridges; more setup.

---

### 2. **Richer persistent memory** (medium impact, medium effort)

“Knowledge graph” style: remembers projects and preferences across months.

- **Structured memory** — Besides `memory.md`, add a small DB or JSON store (e.g. `data/memory.json`) for key-value or graph-like facts (e.g. “user’s timezone”, “current project”). Expose via tools: `get_memory(key)`, `set_memory(key, value)`.
- **Conversation summarization** — Periodically (or on demand) summarize long threads and store “user prefers X” / “project Y” in memory so the system prompt can include recent context.
- **Cross-chat context** — When loading a chat, optionally inject a short “recent facts” block from global memory so the model doesn’t rely only on in-chat history.

---

### 3. **Voice in / voice out** (high impact, high effort)

Voice notes in, TTS replies; wake words; optional voice calls.

- **Voice input** — Browser: Web Speech API or record audio → send to Whisper (local via Ollama or external API). Telegram/WhatsApp: already receive voice notes → same Whisper path.
- **Voice output (TTS)** — Local: Piper, Coqui, or system TTS. Cloud: OpenAI/ElevenLabs if you add API keys. Expose as “read this reply aloud” in the UI and in bots.
- **Wake word** — Optional: always-listening client (browser or desktop app) that triggers the assistant on a phrase; more involved.

*Suggested order:* Voice input (Whisper) in web chat first, then TTS for replies, then bridge to Telegram/Discord voice notes.

---

### 4. **Calendar** (medium impact, medium effort)

Check schedule, create events, reminders (Google/Apple Calendar).

- **Google Calendar** — OAuth2 + Google Calendar API: list events, create event, (optional) quick-add. New skill or built-in tools: `list_calendar_events`, `create_calendar_event`.
- **CalDAV** — For Apple Calendar / Nextcloud / generic: CalDAV client lib; same tool interface. One integration can cover many providers.
- **Reminders** — Either calendar events or reuse Heartbeat: “remind me in 1 hour” → schedule a heartbeat that sends a notification (email or later Telegram/Discord).

---

### 5. **Smart home** (medium impact, skill-friendly)

“Turn off all lights” via Home Assistant (or similar).

- **Home Assistant** — REST + WebSocket; expose as a skill or built-in tools: `call_ha_service(domain, service, data)`. Model can map “turn off living room lights” to the right service call.
- **Generic HTTP** — Skill that calls configurable URLs (GET/POST) so users can wire MQTT, IFTTT, or other APIs without coding.

---

### 6. **Browser control / web automation** (high impact, high effort)

Control Chrome (or headless browser) for scraping and automation.

- **Puppeteer/Playwright** — Run headless browser in a container or on the host; tools: `navigate(url)`, `click(selector)`, `type(selector, text)`, `screenshot()`, `get_content()`. Needs careful sandboxing and timeouts.
- **MCP (Model Context Protocol)** — Add an MCP server that wraps Playwright (or other tools) so ShadowAI can expose “browser” as an MCP tool and keep the rest of the stack unchanged.

*Suggested order:* Start with a single “screenshot + content” tool (navigate, wait, return HTML + PNG) before full control.

---

### 7. **Document processing** (medium impact, medium effort)

PDFs, summarize, extract.

- **PDF text** — Use a lib (e.g. `pdf-parse`) to extract text; tool `read_pdf(path_or_url)` → text for the model.
- **Summarize / extract** — No new infra: model already gets text; add “summarize this” / “extract key points” as natural use of existing context.
- **Office formats** — Optional: docx/xlsx parsing for tables and headings; more dependencies.

---

### 8. **Image understanding (vision)** (high impact, medium effort)

Send photos, get analysis (receipts, objects, scenes).

- **Ollama vision models** — Many Ollama models support images. Extend chat API: allow `content: [{ type: 'text', text: '...' }, { type: 'image_url', url: 'data:image/...' }]` and pass through to Ollama.
- **UI** — Allow paste/attach image in the web chat; send as inline image in the last user message.
- **Telegram/Discord** — When user sends a photo, forward it as image URL or base64 to the same vision API.

---

### 9. **Scheduled tasks & webhooks** (low–medium effort)

Cron, webhooks, “morning briefing,” recurring reminders.

- **Heartbeat** — You already have this; extend with more triggers: “every day at 8am,” “every 15 minutes,” or “when webhook GET /api/heartbeat/trigger/:id” is called.
- **Cron-style schedules** — Store cron expressions in config or DB; a single scheduler loop runs them and invokes the same “run a prompt and optionally send result” logic as Heartbeat.
- **Webhooks** — Public endpoint with a secret: POST body (e.g. “summary of this incident”) → one-shot assistant run → optional reply or email.

---

### 10. **Email: read & draft** (medium impact, medium effort)

Read inbox, draft, send (with confirmation or autonomous).

- **IMAP** — Read inbox (config: host, user, pass, folder). Tools: `list_emails(limit)`, `get_email(id)`. Model can summarize “last 5 emails” or “emails from X.”
- **Draft** — Model suggests subject/body; tool `create_draft(to, subject, body)` or “send with confirmation” (current send_email is already “send”; add “draft” that stores and shows in UI for approval).
- **Autonomous send** — Config flag: “allow AI to send without confirmation” (current behavior when enabled); otherwise require explicit “send” step.

---

### 11. **MCP (Model Context Protocol)** (high impact for power users, medium effort)

MCP for advanced tools and integrations.

- **MCP server** — Run an MCP server alongside ShadowAI that exposes tools (browser, calendar, custom scripts). The assistant calls MCP tools instead of (or in addition to) built-in tools and skills.
- **Ollama / OpenAI compatibility** — Some stacks expect tools in a given format; ensure the chat API can translate between your tool schema and MCP so one integration works for many clients.

---

### 12. **Better UX and polish** (ongoing)

- **Streaming in bots** — Telegram/Discord show typing and streamed text as it arrives.
- **Inline actions** — Buttons in chat: “Run this”, “Add to calendar”, “Send email” (execute, don’t just suggest).
- **Skills marketplace / discovery** — List community skills (e.g. from a repo or registry); one-click install into `skills/<id>`.

---

## Suggested order of work

1. **Quick wins** — CLI client; webhook trigger for Heartbeat; PDF text tool (or a single “read document” skill).
2. **High value, contained scope** — Vision (images in chat); calendar (one provider, e.g. Google or CalDAV); email read (IMAP).
3. **Channels** — Telegram bot, then Discord; reuse same `/api/chat` and auth.
4. **Automation** — Richer Heartbeat (cron, webhooks); smart home (Home Assistant skill or generic HTTP).
5. **Bigger bets** — Browser automation (Puppeteer/Playwright or MCP); richer memory (structured store + summarization); voice (Whisper + TTS).

If you say which area you want to tackle first (e.g. “Telegram bot” or “vision” or “calendar”), the next step is to break that into concrete tasks and API changes for ShadowAI.
