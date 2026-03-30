# Autonomous Agent — Design Spec
**Date:** 2026-03-30
**Status:** Approved

---

## Overview

Add an autonomous task-executor agent to ShadowAI. Given a goal, the agent plans and executes steps independently using the existing tool ecosystem (skills, web search, memory, code execution, email). It runs persistently on the server, gets more capable over time through three learning mechanisms, and requires user approval before irreversible actions.

---

## 1. Data Model & Storage

### Task file: `data/agents/{taskId}.json`

```json
{
  "id": "uuid",
  "title": "Short human-readable goal title",
  "goal": "Full goal description",
  "status": "queued | planning | executing | awaiting_approval | complete | failed | blocked",
  "blockedBehavior": "pause | continue | notify",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "plan": [
    { "step": 1, "description": "...", "status": "pending | done | failed" }
  ],
  "currentStep": 0,
  "log": [
    { "ts": "ISO", "type": "thought | action | result | approval_request | learn", "content": "..." }
  ],
  "pendingApproval": {
    "action": "send_email",
    "args": { "to": "...", "subject": "..." },
    "requestedAt": "ISO"
  },
  "learnings": {
    "strategyNotes": "...",
    "skillsCreated": ["skill-id"],
    "factsAdded": ["memory key"]
  }
}
```

### Index file: `data/agents/index.json`

Tracks all task IDs and current statuses for fast listing without reading every task file.

```json
[
  { "id": "uuid", "title": "...", "status": "executing", "updatedAt": "ISO" }
]
```

### Strategy memory: `data/agents/strategy.md`

Append-only log of lessons learned across completed tasks. Injected into every agent task's system prompt.

### Config additions to `config.json`

```json
{
  "agent": {
    "maxConcurrent": 2,
    "loopIntervalMs": 5000
  }
}
```

---

## 2. Agent Runtime (`lib/agentRunner.js`)

A standalone module that starts with the server and manages all active tasks.

### Loop

Runs every `loopIntervalMs` (default 5000ms). On each tick:
1. Load all non-terminal tasks from `data/agents/`
2. Filter out tasks already in-flight; respect `maxConcurrent`
3. Advance each eligible task by one reasoning step (async, non-blocking)

### Task lifecycle

```
queued → planning
  LLM call: "Given this goal, create a step-by-step plan."
  Saves plan[] to task file.

planning → executing
  Each tick: LLM call with goal + plan + log so far.
  LLM returns one of:
    - tool call  → check approval tier, execute or pause for approval
    - thought    → append to log, stay on current step
    - "done"     → mark step complete, advance currentStep
    - "blocked"  → apply blockedBehavior (pause | continue | notify)

executing → awaiting_approval (when action requires approval)
  Write pendingApproval to task file. Pause task.
  Send notification (email/Discord/Telegram) if configured.
  Resume when user approves or rejects via API.

all steps done → complete
  Trigger learning phase.

any unrecoverable error → failed
  Log error, stop advancing task.
```

### Approval tiers

- **Low-risk (runs freely):** web_search, fetch_url, get_memory, read operations, thought logging, strategy note writes
- **High-risk (requires approval):** send_email, run_code, create_skill, set_memory, append_memory, any file write

### Reuse of existing modules

- **`lib/chatRunner.js`** — used for each LLM reasoning step; provides tool execution for skills, web search, memory, code execution
- **`lib/ollama.js`** — LLM calls
- **`lib/skills.js`** — skill invocation
- **`lib/structuredMemory.js`** — fact accumulation
- **`lib/config.js`** — agent config read/write

---

## 3. API Routes

All routes are admin-only and mounted at `/api/agent/`.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/agent/tasks` | List all tasks (id, title, status, progress) |
| `POST` | `/api/agent/tasks` | Create task (goal, blockedBehavior) |
| `GET` | `/api/agent/tasks/:id` | Full task detail (plan, log, learnings) |
| `DELETE` | `/api/agent/tasks/:id` | Cancel/delete a task |
| `POST` | `/api/agent/tasks/:id/approve` | Approve pending action |
| `POST` | `/api/agent/tasks/:id/reject` | Reject pending action (with reason) |
| `POST` | `/api/agent/tasks/:id/unblock` | Manually unblock a paused task |
| `GET` | `/api/agent/config` | Get agent config |
| `PUT` | `/api/agent/config` | Update agent config |

### Chat integration

- `/agent goal <text>` in chat creates a task and returns a confirmation with a dashboard link.
- Natural language assignment ("Agent, go research X") detected via system prompt instruction.

---

## 4. Dashboard UI

New `AGENT` nav item (admin-only). Single-page layout with four sections:

### Task list
Cards showing title, status badge, step progress bar (currentStep / plan.length), last log entry timestamp.

### Task detail panel
Opens on card click. Shows:
- Full plan with step status indicators
- Scrollable log with type-colored entries (thought, action, result, approval_request, learn)
- Learnings summary (strategy notes, skills created, facts added)

### Approval queue
Highlighted cards for `awaiting_approval` tasks at the top of the list. Shows the pending action and args. Approve / Reject buttons with optional rejection reason input.

### New task form
- Goal text area
- Blocked behavior selector (pause / continue / notify)
- Submit button

### Config section (bottom of page)
- maxConcurrent input
- Loop interval input
- Save button

---

## 5. Learning System

Triggered after a task reaches `complete`. A final LLM call reviews the full task log and extracts three types of knowledge:

### Strategy memory
Short lessons appended to `data/agents/strategy.md`. Written freely (low-risk). Examples:
- "When fetching URLs behind login walls, web_search for a cached/public version first."
- "Breaking research tasks into 3–5 sub-questions before searching produces better results."

Injected into the system prompt for every future agent task.

### Skill creation
If the agent identified a reusable code pattern or tool sequence, it calls the existing `create_skill` tool to package it as a plugin. Recorded in `learnings.skillsCreated`. **Requires approval.**

### Fact accumulation
Discoveries made during task work written to structured memory via `set_memory`/`append_memory`. Recorded in `learnings.factsAdded`. **Requires approval.**

---

## 6. File Summary

| Path | Type | Purpose |
|------|------|---------|
| `lib/agentRunner.js` | New | Core agent runtime and loop |
| `lib/agentStore.js` | New | Task file CRUD (read/write/list/delete) |
| `server.js` | Modified | Mount `/api/agent/*` routes, start agentRunner |
| `public/agent.html` | New | Dashboard UI page |
| `public/js/agent.js` | New | Dashboard frontend logic |
| `data/agents/` | New dir | Task JSON files + index.json + strategy.md |
| `config.json` | Modified | Add `agent` config section |

---

## 7. Out of Scope

- Inter-agent communication (multiple agents coordinating)
- Agent-to-agent task delegation
- Visual pipeline integration for agent steps
- Per-user agents (agent is a single admin-level process)
