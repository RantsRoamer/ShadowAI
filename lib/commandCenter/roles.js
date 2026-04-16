'use strict';

/**
 * Roles are lightweight “specialized agents”.
 * We map roles to optional configured Ollama agent presets (config.ollama.agents[]).
 * If the agent preset doesn't exist or is disabled, the system falls back to main.
 */

const ROLES = {
  triage: {
    id: 'triage',
    label: 'Triage / Coordinator',
    preferredAgentId: 'triage',
    systemAppendix: [
      'You are the Command Center coordinator.',
      'Your job: break user missions into actionable subtasks and assign a best-fit role for each.',
      'Always keep it lightweight and layered on top of Shadow core. Avoid major refactors.',
      'All LLM calls must use Shadow’s existing Ollama integration.'
    ].join('\n')
  },
  coder: {
    id: 'coder',
    label: 'Coder',
    preferredAgentId: 'coder',
    systemAppendix: 'You are a coding-focused agent. Prefer minimal, safe changes that follow existing project patterns.'
  },
  research: {
    id: 'research',
    label: 'Research',
    preferredAgentId: 'research',
    systemAppendix: 'You are a research agent. Use internal tools and existing Shadow capabilities; summarize findings concisely.'
  },
  planner: {
    id: 'planner',
    label: 'Planner',
    preferredAgentId: 'planner',
    systemAppendix: 'You are a planning agent. Produce clear, step-by-step plans aligned with existing Shadow architecture.'
  },
  memory_curator: {
    id: 'memory_curator',
    label: 'Memory Curator',
    preferredAgentId: 'memory',
    systemAppendix: 'You curate shared hive memory: classify, pin, summarize, archive. Keep outputs structured and minimal.'
  },
  ops: {
    id: 'ops',
    label: 'Ops',
    preferredAgentId: 'ops',
    systemAppendix: 'You are an ops agent. Focus on reliability, observability, and safe automation.'
  }
};

function getRole(roleId) {
  const key = String(roleId || '').trim().toLowerCase();
  return ROLES[key] || ROLES.coder;
}

function listRoles() {
  return Object.values(ROLES);
}

module.exports = { getRole, listRoles, ROLES };

