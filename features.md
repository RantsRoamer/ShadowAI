# ShadowAI Feature Breakdown (Build-From-Scratch Guide)

This document breaks down the system into implementation-ready features and suggested build order. It is written for a developer rebuilding ShadowAI from zero while preserving current behavior.

## 1) Product Scope (What This System Is)

ShadowAI is a multi-user AI assistant platform with:
- Web UI (chat-first app with admin pages)
- Ollama-backed LLM runtime (main model + optional agent models)
- Tool-enabled chat (memory tools, web fetch/search, email, scheduler tools, skills)
- Project workspaces with isolated memory and chat
- Scheduling/automation (heartbeat jobs + node-based pipelines)
- Knowledge retrieval (local RAG index)
- Optional external channels (CLI, Telegram, Discord, Matrix)

## 2) Core Architecture

## Backend
- Single Node.js/Express server (`server.js`) exposing HTML pages and JSON APIs.
- Feature logic in `lib/*` modules.
- JSON/file-based persistence for most app data; SQLite for users/roles.
- Ollama HTTP APIs used for chat and embeddings.

## Frontend
- Multi-page HTML app under `public/`:
  - User pages: `dashboard`, `app`, `projects`, `project`, `skills`, `rag`, `profile`, `my-data`, `command-center`
  - Admin pages: `config`, `personality`, `heartbeat`, `agents`, `pipelines`, `users`, `editor`, `debug`, `autoagent`

## Data Storage
- `data/users.db` for auth/users/roles.
- `data/chats/*` for chat logs.
- `data/projects/*` for project metadata and memory.
- `data/vectors/*` for RAG vectors/chunks.
- `data/pipelines.json` for pipeline definitions.
- `data/hivemind/*` for command-center mission/event memory.
- `data/personality.md`, `data/memory.md`, `data/AIBEHAVIOR.md`, `data/memory.json`.

## 3) Feature Modules

## A. Authentication + Authorization
- Login/logout/session handling.
- Role-based control: `admin`, `user`, `guest`.
- Admin-only routes/pages for system-level settings.
- Per-project access levels:
  - Read-only: chat only
  - User: chat + memory editing/import
  - Admin: full project control

Implementation notes:
- Build auth middleware early.
- Add route guards and server-side role checks first (do not rely on UI checks).

## B. Chat Engine (Main Runtime)
- Chat completion via Ollama with configurable model/URL.
- Optional per-chat agent/model override.
- System prompt assembly includes personality/memory/behavior context.
- Tool-call loop with bounded rounds and tool result injection.
- Token usage reporting.

Tooling currently included:
- Memory tools: append memory, structured memory get/set
- Web tools: search (SearXNG), URL fetch
- Email send
- Scheduler/skills tools
- Extra agent-loop tools (command-center hooks)

Implementation notes:
- Build pure chat first.
- Then add tool loop.
- Then add memory injection and custom instructions.

## C. Chat History + Conversation Management
- Create/list/delete conversations.
- Reset chat history.
- Search chat history.
- Attachments flow for chat endpoint.
- Separate channel/user conversation identities.

Implementation notes:
- Use a storage abstraction (`chatStore` style) so channels/web can share history logic.

## D. Personality + Long-Term Memory
- Editable persona files:
  - Personality (`personality.md`)
  - Free-form memory (`memory.md`)
  - AI behavior profile (`AIBEHAVIOR.md`)
- Structured key-value memory (`memory.json`) with API + tool access.
- Memory append utility with dedupe behavior for line entries.

Implementation notes:
- Keep user-scoped variants from day one (global + per-user paths).

## E. Skills / Plugin System
- Skill package format (`skills/<id>/skill.json` + `run.js`).
- Runtime load/enable/disable without restart.
- Skill CRUD APIs.
- Execute skills from chat and heartbeat/pipelines.

Implementation notes:
- Sandbox or constrain execution boundary.
- Validate skill IDs and exported `run(args)` contract.

## F. Heartbeat Scheduler
- Cron-based periodic jobs, evaluated every 30s.
- Job types:
  - Prompt (ask model to run a prompt)
  - Skill (run skill with args)
- `lastRunAt` persistence and catch-up behavior after downtime.
- Optional email delivery of skill result.

Implementation notes:
- Persist schedules in config.
- Add run-now endpoint and cron preview tooling for UX.

## G. Projects Workspace
- CRUD projects with isolated memory and project-specific chat.
- Per-project sharing/access control.
- Memory editor and memory consolidation/normalization utilities.
- Import pipeline for text/PDF/DOC/DOCX/images into project memory.
- Debug/repair operations for memory consistency.

Implementation notes:
- Hard-enforce project access server-side for every read/write endpoint.
- Memory normalization is important because LLM output quality depends on clean project docs.

## H. Project Email Reports
- Multiple named report configs per user.
- Select projects, recipient, schedule, prompt template.
- Send-now and scheduled sending.
- AI-formatted report body from project memory.
- Duplicate-run protection and `lastRunAt`.
- HTML/markdown email body support.

Implementation notes:
- Deterministic memory preprocessing before prompting is critical (dedupe stale finance/status sections).

## I. RAG (Knowledge Index)
- Document upload and text extraction.
- Chunking + overlap settings.
- Embeddings via Ollama embedding endpoint.
- Local JSON vector collection storage.
- Similarity query and top-k retrieval.
- Global or project-scoped collections.
- Optional index of project memory as a document source.

Implementation notes:
- Start with local JSON index for simplicity.
- Keep source metadata for citations/debugging.

## J. Pipelines (Node-Based Automation)
- Persisted pipeline graph with nodes and connections.
- Node types:
  - trigger (schedule/webhook/manual entry)
  - skill
  - prompt
  - email
  - webhook_out
  - if (condition branch)
- Variable substitution (`{{var}}`) across node inputs.
- Safe expression evaluation for conditions (VM sandbox).
- Scheduler integration for cron triggers.
- Webhook trigger execution with optional secret.
- Observability events/runs/alerts and optional alert delivery.

Implementation notes:
- Implement execution engine with deterministic traversal and guarded retries.
- Add observability early; it is required for troubleshooting.

## K. Multi-Channel Interfaces
- CLI integration using API key.
- Telegram bot (optional dependency).
- Discord bot with user allowlist and reset command.
- Matrix bot with token/password login options and allowlist.
- Channel messages mapped to synthetic per-user chat identities.

Implementation notes:
- Build web API first, then adapters per channel.
- Keep channel adapters thin; core logic should stay in shared chat runner.

## L. Code Execution + File Editor Endpoints
- `/api/run` endpoint for constrained JS/Python execution.
- File read/write/list endpoints for project-local editing.
- Dedicated "My Data" file APIs for user data browsing.

Implementation notes:
- Enforce path safety and extension allowlists.
- Add execution time/output limits.

## M. Command Center / Agent Orchestration
- Mission intake and LLM triage into subtasks with roles.
- Task creation and role-to-agent assignment.
- Mission state stored in HiveMind snapshot/event log.
- Mission auto-finalization with synthesized completion report.
- Admin controls: stop agents, clear scoped mission memory, master kill switch.

Implementation notes:
- This is an advanced layer; build after core chat, skills, and scheduling are stable.

## N. Configuration + Admin Controls
- Central config API with runtime reload semantics.
- Ollama settings (main model + agents).
- Channel, email, security, RAG, observability, UI settings.
- Avatar upload/removal.
- Model list/capability diagnostics.
- Debug endpoints for memory and SearXNG.

Implementation notes:
- Separate mutable runtime config from immutable boot env where possible.

## 4) Recommended Build Order (Milestones)

## Milestone 1: Foundation
- Express server, sessions, login/logout, basic user DB.
- Config loader/updater.
- Basic pages and static assets.

## Milestone 2: Core Chat
- Chat endpoint + Ollama integration.
- Chat history storage.
- System prompt assembly with personality/memory.

## Milestone 3: Tools + Skills
- Tool-call loop.
- Memory tools + web fetch/search + email tool.
- Skill runtime + CRUD + execution.

## Milestone 4: Projects
- Project CRUD, isolated memory/chat, access control.
- Importers (text/PDF/images).
- Memory consolidation utilities.

## Milestone 5: Scheduling + Reports
- Heartbeat scheduler.
- Project email reports with prompt-driven formatting.

## Milestone 6: RAG
- Upload, extract, chunk, embed, retrieve.
- Chat command integration for retrieval-augmented answers.

## Milestone 7: Pipelines + Observability
- Graph runtime, triggers, node execution.
- Run logs/events/alerts.

## Milestone 8: Channels + Command Center
- CLI/Telegram/Discord/Matrix adapters.
- Mission orchestration, HiveMind memory, mission reporting.

## 5) Non-Functional Requirements

- Security-first route guarding and project-level authorization.
- Input validation on all API bodies.
- Safe filesystem path handling and extension allowlists.
- Bounded runtime for executed code and model tool loops.
- Resilient scheduler behavior across restarts.
- Clear observability (logs + run/event trails).

## 6) Testing Strategy (Minimum)

- Unit tests:
  - memory normalization/consolidation
  - scheduler due-time logic
  - pipeline branch/execution behavior
  - report memory preprocessing
- Integration tests:
  - auth + role guards
  - project share permissions
  - chat + tool-call happy path
  - report generation from conflicting memory states
- Smoke tests:
  - startup with empty data dir
  - model connectivity check
  - scheduled job execution and persistence

## 7) Implementation Risks to Handle Early

- Stale/conflicting memory sections leading to incorrect report math.
- Cron timezone mismatches.
- Optional dependency failures (bots, PDF/DOC parsers).
- Tool-call loops running too long or using malformed tool args.
- Project/channel data leakage if user scoping is not enforced everywhere.
