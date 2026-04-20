(function () {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let pipelines = [];          // all pipelines from server
  let current = null;          // currently open pipeline object (deep copy)
  let selectedNodeId = null;   // node selected for config panel
  let connectingFrom = null;   // nodeId we're drawing a connection from
  let dragging = null;         // { nodeId, startMouseX, startMouseY, startNodeX, startNodeY }
  let dragMoved = false;       // true if mousedown moved enough to count as drag

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const pipelineList    = document.getElementById('pipelineList');
  const newPipelineBtn  = document.getElementById('newPipelineBtn');
  const emptyState      = document.getElementById('emptyState');
  const emptyNewBtn     = document.getElementById('emptyNewBtn');
  const pipelineEditor  = document.getElementById('pipelineEditor');
  const pipelineNameInput = document.getElementById('pipelineNameInput');
  const pipelineEnabled = document.getElementById('pipelineEnabled');
  const savePipelineBtn = document.getElementById('savePipelineBtn');
  const runNowBtn       = document.getElementById('runNowBtn');
  const saveStatus      = document.getElementById('pipelineSaveStatus');
  const canvasDiv       = document.getElementById('pipelineCanvas');
  const canvas          = document.getElementById('connectionLayer');
  const ctx             = canvas.getContext('2d');
  const nodeConfigPanel = document.getElementById('nodeConfigPanel');
  const nodeConfigContent = document.getElementById('nodeConfigContent');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function escapeHtml(s) {
    if (s == null) return '';
    const el = document.createElement('div');
    el.textContent = String(s);
    return el.innerHTML;
  }

  function nodeId() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function setStatus(msg, isError) {
    saveStatus.textContent = msg;
    saveStatus.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  // ---------------------------------------------------------------------------
  // Resize canvas to fill container
  // ---------------------------------------------------------------------------
  function resizeCanvas() {
    const container = document.getElementById('canvasContainer');
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    redrawConnections();
  }

  // ---------------------------------------------------------------------------
  // Connection drawing
  // ---------------------------------------------------------------------------
  function getNodeRect(nodeId) {
    const el = document.getElementById('node-' + nodeId);
    if (!el) return null;
    return { x: parseInt(el.style.left, 10) || 0, y: parseInt(el.style.top, 10) || 0, w: el.offsetWidth, h: el.offsetHeight };
  }

  function drawArrowhead(x, y, angle) {
    const size = 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size / 2);
    ctx.lineTo(-size, size / 2);
    ctx.closePath();
    ctx.fillStyle = '#00ff88';
    ctx.fill();
    ctx.restore();
  }

  function redrawConnections() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!current) return;
    for (const conn of (current.connections || [])) {
      const from = getNodeRect(conn.from);
      const to   = getNodeRect(conn.to);
      if (!from || !to) continue;
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = to.y + to.h / 2;
      const cp = Math.max((x2 - x1) / 2, 40);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1 + cp, y1, x2 - cp, y2, x2, y2);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();
      // arrowhead
      const angle = Math.atan2(y2 - (y2 - cp * 0.05), x2 - (x2 - 1));
      drawArrowhead(x2, y2, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // Render pipeline node div
  // ---------------------------------------------------------------------------
  function typeLabel(type) {
    const labels = { trigger: 'TRIGGER', skill: 'SKILL', prompt: 'AI PROMPT', if: 'CONDITION', email: 'EMAIL', webhook_out: 'WEBHOOK OUT' };
    return labels[type] || type.toUpperCase();
  }

  function nodeBodyText(node) {
    switch (node.type) {
      case 'trigger':  return node.triggerType === 'schedule' ? (node.schedule || 'no schedule') : (node.triggerType || 'manual');
      case 'skill':    return node.skillId || '(no skill)';
      case 'prompt':   return (node.prompt || '').slice(0, 40) + ((node.prompt || '').length > 40 ? '…' : '');
      case 'if':       return (node.expression || '').slice(0, 40) || 'context.payload.ok === true';
      case 'email':    return node.subject || '(no subject)';
      case 'webhook_out': return (node.url || '').slice(0, 35);
      default:         return '';
    }
  }

  function renderNode(node) {
    let el = document.getElementById('node-' + node.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'pipeline-node';
      el.id = 'node-' + node.id;
      canvasDiv.appendChild(el);
      // Drag events
      el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('node-connect-btn')) return;
        if (connectingFrom) {
          // Finish connection
          if (connectingFrom !== node.id) {
            if (!current.connections.some(c => c.from === connectingFrom && c.to === node.id)) {
              let condition = null;
              const fromNode = current.nodes.find((n) => n.id === connectingFrom);
              if (fromNode && fromNode.type === 'if') {
                const pick = prompt('Condition branch for this edge? Type "true" or "false" (blank defaults to true):', 'true');
                if (pick != null) {
                  const norm = String(pick).trim().toLowerCase();
                  condition = norm === 'false' ? 'false' : 'true';
                }
              }
              current.connections.push({ from: connectingFrom, to: node.id, condition });
              redrawConnections();
            }
          }
          connectingFrom = null;
          canvasDiv.classList.remove('connecting-mode');
          document.querySelectorAll('.pipeline-node').forEach(n => n.classList.remove('connecting-target'));
          return;
        }
        dragging = {
          nodeId: node.id,
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          startNodeX: node.x,
          startNodeY: node.y
        };
        dragMoved = false;
        e.preventDefault();
      });
      // Right-click to delete connections involving this node
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // noop — connection deletion handled on canvas
      });
    }
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
    el.classList.toggle('selected', selectedNodeId === node.id);
    el.innerHTML = `
      <div class="node-header">
        <span class="node-type-label">${escapeHtml(typeLabel(node.type))}</span>
      </div>
      <div class="node-body">
        <div class="node-name">${escapeHtml(node.type === 'trigger' ? (node.label || 'Trigger') : (node.outputVar || node.skillId || node.type))}</div>
        <div style="margin-top:2px;">${escapeHtml(nodeBodyText(node))}</div>
      </div>
      <div class="node-footer">
        <button class="node-connect-btn" title="Connect to another node">→</button>
      </div>
    `;
    el.querySelector('.node-connect-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      connectingFrom = node.id;
      canvasDiv.classList.add('connecting-mode');
      document.querySelectorAll('.pipeline-node').forEach(n => {
        n.classList.toggle('connecting-target', n.id !== 'node-' + node.id);
      });
    });
  }

  function renderAllNodes() {
    // Remove stale nodes
    canvasDiv.querySelectorAll('.pipeline-node').forEach(el => {
      const id = el.id.replace('node-', '');
      if (!(current && current.nodes.some(n => n.id === id))) el.remove();
    });
    if (!current) return;
    for (const node of current.nodes) renderNode(node);
  }

  // ---------------------------------------------------------------------------
  // Canvas mouse events
  // ---------------------------------------------------------------------------
  function onCanvasMouseMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragging.startMouseX;
    const dy = e.clientY - dragging.startMouseY;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
    const node = current && current.nodes.find(n => n.id === dragging.nodeId);
    if (!node) return;
    node.x = Math.max(0, dragging.startNodeX + dx);
    node.y = Math.max(0, dragging.startNodeY + dy);
    const el = document.getElementById('node-' + node.id);
    if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
    redrawConnections();
  }

  function onCanvasMouseUp(e) {
    if (dragging) {
      const didMove = dragMoved;
      const dNodeId = dragging.nodeId;
      dragging = null;
      dragMoved = false;
      // If didn't move, treat as click → select node
      if (!didMove) selectNode(dNodeId);
    }
  }

  function onCanvasClick(e) {
    if (e.target === canvasDiv || e.target === canvas) {
      // Cancel connect mode
      if (connectingFrom) {
        connectingFrom = null;
        canvasDiv.classList.remove('connecting-mode');
        document.querySelectorAll('.pipeline-node').forEach(n => n.classList.remove('connecting-target'));
      }
      // Deselect
      selectNode(null);
    }
  }

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // Right-click on canvas: delete connection if near one (simplified: delete last)
    // For a production version, we'd hit-test bezier curves.
    // For now, right-click canvas and a connection is removed from context menu
    if (!current || !current.connections.length) return;
    if (confirm('Delete last connection?')) {
      current.connections.pop();
      redrawConnections();
    }
  });

  document.addEventListener('mousemove', onCanvasMouseMove);
  document.addEventListener('mouseup', onCanvasMouseUp);
  canvasDiv.addEventListener('click', onCanvasClick);

  window.addEventListener('resize', resizeCanvas);

  // ---------------------------------------------------------------------------
  // Node selection + config panel
  // ---------------------------------------------------------------------------
  function selectNode(id) {
    selectedNodeId = id;
    document.querySelectorAll('.pipeline-node').forEach(el => el.classList.remove('selected'));
    if (id) {
      const el = document.getElementById('node-' + id);
      if (el) el.classList.add('selected');
    }
    renderConfigPanel();
  }

  function renderConfigPanel() {
    if (!selectedNodeId || !current) {
      nodeConfigPanel.classList.remove('open');
      return;
    }
    const node = current.nodes.find(n => n.id === selectedNodeId);
    if (!node) { nodeConfigPanel.classList.remove('open'); return; }
    nodeConfigPanel.classList.add('open');

    let fields = '';
    if (node.type === 'trigger') {
      fields = `
        <div class="cfg-group"><label>Trigger type</label>
          <select id="cfg-triggerType">
            <option value="schedule" ${node.triggerType === 'schedule' ? 'selected' : ''}>Schedule (cron)</option>
            <option value="manual" ${node.triggerType === 'manual' ? 'selected' : ''}>Manual only</option>
            <option value="webhook" ${node.triggerType === 'webhook' ? 'selected' : ''}>Webhook</option>
          </select>
        </div>
        <div class="cfg-group" id="cfg-schedule-wrap" ${node.triggerType !== 'schedule' ? 'style="display:none"' : ''}>
          <label>Cron schedule</label>
          <input type="text" id="cfg-schedule" value="${escapeHtml(node.schedule || '')}" placeholder="0 8 * * *" />
        </div>
        <div class="cfg-group" id="cfg-webhook-wrap" ${node.triggerType !== 'webhook' ? 'style="display:none"' : ''}>
          <label>Webhook ID</label>
          <input type="text" id="cfg-webhookId" value="${escapeHtml(node.webhookId || '')}" placeholder="orders-created" />
          <label>Webhook secret (optional)</label>
          <input type="text" id="cfg-webhookSecret" value="${escapeHtml(node.webhookSecret || '')}" placeholder="shared-secret" />
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">POST /api/pipelines/webhook/${escapeHtml(node.webhookId || '<id>')}</div>
        </div>
        <div class="cfg-group"><label>Label</label>
          <input type="text" id="cfg-label" value="${escapeHtml(node.label || '')}" placeholder="Trigger" />
        </div>
      `;
    } else if (node.type === 'skill') {
      fields = `
        <div class="cfg-group"><label>Skill ID</label>
          <input type="text" id="cfg-skillId" value="${escapeHtml(node.skillId || '')}" placeholder="my-skill" />
        </div>
        <div class="cfg-group"><label>Args (JSON object)</label>
          <textarea id="cfg-args" placeholder="{}">${escapeHtml(node.args ? JSON.stringify(node.args, null, 2) : '')}</textarea>
        </div>
        <div class="cfg-group"><label>Output variable</label>
          <input type="text" id="cfg-outputVar" value="${escapeHtml(node.outputVar || '')}" placeholder="result" />
        </div>
      `;
    } else if (node.type === 'prompt') {
      fields = `
        <div class="cfg-group"><label>Prompt (use {{varName}} for context vars)</label>
          <textarea id="cfg-prompt" placeholder="Summarize: {{result}}">${escapeHtml(node.prompt || '')}</textarea>
        </div>
        <div class="cfg-group"><label>Output variable</label>
          <input type="text" id="cfg-outputVar" value="${escapeHtml(node.outputVar || '')}" placeholder="summary" />
        </div>
      `;
    } else if (node.type === 'if') {
      fields = `
        <div class="cfg-group"><label>Expression (JS, context available as \`context\`)</label>
          <textarea id="cfg-expression" placeholder="context.payload.total > 1000">${escapeHtml(node.expression || '')}</textarea>
        </div>
        <div class="cfg-group"><label>Hint</label>
          <div style="font-size:10px;color:var(--text-dim)">Connect this node to next nodes and assign each edge to true/false when prompted.</div>
        </div>
      `;
    } else if (node.type === 'email') {
      fields = `
        <div class="cfg-group"><label>Subject</label>
          <input type="text" id="cfg-subject" value="${escapeHtml(node.subject || '')}" placeholder="Pipeline result" />
        </div>
        <div class="cfg-group"><label>Body (use {{varName}} for context vars)</label>
          <textarea id="cfg-body" placeholder="{{summary}}">${escapeHtml(node.body || '')}</textarea>
        </div>
      `;
    } else if (node.type === 'webhook_out') {
      fields = `
        <div class="cfg-group"><label>URL</label>
          <input type="text" id="cfg-url" value="${escapeHtml(node.url || '')}" placeholder="https://example.com/hook" />
        </div>
        <div class="cfg-group"><label>Body template (JSON, use {{varName}})</label>
          <textarea id="cfg-bodyTemplate" placeholder='{"result": "{{summary}}"}'>${escapeHtml(node.bodyTemplate || '')}</textarea>
        </div>
        <div class="cfg-group"><label>Output variable</label>
          <input type="text" id="cfg-outputVar" value="${escapeHtml(node.outputVar || '')}" placeholder="webhookStatus" />
        </div>
      `;
    }

    nodeConfigContent.innerHTML = fields + `
      <button type="button" class="btn cfg-delete-btn" id="cfgDeleteBtn">Delete node</button>
    `;

    // Live-update node on change
    nodeConfigContent.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', () => applyConfigToNode(node));
      el.addEventListener('change', () => applyConfigToNode(node));
    });

    // Trigger type change shows/hides schedule input
    const triggerTypeEl = document.getElementById('cfg-triggerType');
    if (triggerTypeEl) {
      triggerTypeEl.addEventListener('change', () => {
        const wrap = document.getElementById('cfg-schedule-wrap');
        if (wrap) wrap.style.display = triggerTypeEl.value === 'schedule' ? '' : 'none';
        const webhookWrap = document.getElementById('cfg-webhook-wrap');
        if (webhookWrap) webhookWrap.style.display = triggerTypeEl.value === 'webhook' ? '' : 'none';
      });
    }

    document.getElementById('cfgDeleteBtn').addEventListener('click', () => {
      current.nodes = current.nodes.filter(n => n.id !== node.id);
      current.connections = current.connections.filter(c => c.from !== node.id && c.to !== node.id);
      const el = document.getElementById('node-' + node.id);
      if (el) el.remove();
      selectNode(null);
      redrawConnections();
    });
  }

  function applyConfigToNode(node) {
    if (node.type === 'trigger') {
      const tt = document.getElementById('cfg-triggerType');
      if (tt) node.triggerType = tt.value;
      const sc = document.getElementById('cfg-schedule');
      if (sc) node.schedule = sc.value;
      const lb = document.getElementById('cfg-label');
      if (lb) node.label = lb.value;
      const wid = document.getElementById('cfg-webhookId');
      if (wid) node.webhookId = wid.value.trim();
      const ws = document.getElementById('cfg-webhookSecret');
      if (ws) node.webhookSecret = ws.value;
    } else if (node.type === 'skill') {
      const si = document.getElementById('cfg-skillId');
      if (si) node.skillId = si.value;
      const ar = document.getElementById('cfg-args');
      if (ar) { try { node.args = JSON.parse(ar.value || '{}'); } catch (_) {} }
      const ov = document.getElementById('cfg-outputVar');
      if (ov) node.outputVar = ov.value;
    } else if (node.type === 'prompt') {
      const pr = document.getElementById('cfg-prompt');
      if (pr) node.prompt = pr.value;
      const ov = document.getElementById('cfg-outputVar');
      if (ov) node.outputVar = ov.value;
    } else if (node.type === 'if') {
      const ex = document.getElementById('cfg-expression');
      if (ex) node.expression = ex.value;
    } else if (node.type === 'email') {
      const su = document.getElementById('cfg-subject');
      if (su) node.subject = su.value;
      const bo = document.getElementById('cfg-body');
      if (bo) node.body = bo.value;
    } else if (node.type === 'webhook_out') {
      const ur = document.getElementById('cfg-url');
      if (ur) node.url = ur.value;
      const bt = document.getElementById('cfg-bodyTemplate');
      if (bt) node.bodyTemplate = bt.value;
      const ov = document.getElementById('cfg-outputVar');
      if (ov) node.outputVar = ov.value;
    }
    renderNode(node);
  }

  // ---------------------------------------------------------------------------
  // Open a pipeline in the editor
  // ---------------------------------------------------------------------------
  function openPipeline(id) {
    const p = pipelines.find(p => p.id === id);
    if (!p) return;
    current = JSON.parse(JSON.stringify(p)); // deep copy
    selectedNodeId = null;
    connectingFrom = null;
    pipelineNameInput.value = current.name || '';
    pipelineEnabled.checked = current.enabled !== false;
    emptyState.style.display = 'none';
    pipelineEditor.style.display = 'flex';
    pipelineEditor.style.flexDirection = 'column';
    pipelineEditor.style.height = '100%';
    renderPipelineList();
    renderAllNodes();
    setTimeout(() => { resizeCanvas(); }, 50);
  }

  // ---------------------------------------------------------------------------
  // Pipeline list sidebar
  // ---------------------------------------------------------------------------
  function renderPipelineList() {
    if (pipelines.length === 0) {
      pipelineList.innerHTML = '<li style="color:var(--text-dim);font-size:11px;padding:8px 10px;">No pipelines yet</li>';
      return;
    }
    pipelineList.innerHTML = pipelines.map(p => `
      <li class="${current && p.id === current.id ? 'active' : ''}" data-id="${escapeHtml(p.id)}">
        <span class="pl-name">${escapeHtml(p.name)}</span>
        <span class="pl-del" data-del-id="${escapeHtml(p.id)}">✕</span>
      </li>
    `).join('');
    pipelineList.querySelectorAll('li[data-id]').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('pl-del')) return;
        openPipeline(li.dataset.id);
      });
    });
    pipelineList.querySelectorAll('.pl-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete pipeline "' + pipelines.find(p => p.id === btn.dataset.delId)?.name + '"?')) return;
        await fetch('/api/pipelines/' + encodeURIComponent(btn.dataset.delId), { method: 'DELETE' });
        if (current && current.id === btn.dataset.delId) {
          current = null;
          emptyState.style.display = '';
          pipelineEditor.style.display = 'none';
          canvasDiv.querySelectorAll('.pipeline-node').forEach(el => el.remove());
        }
        await loadPipelines();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Load pipelines from server
  // ---------------------------------------------------------------------------
  async function loadPipelines() {
    try {
      const res = await fetch('/api/pipelines');
      if (!res.ok) throw new Error(res.statusText);
      pipelines = await res.json();
      renderPipelineList();
    } catch (e) {
      console.error('Failed to load pipelines:', e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Create new pipeline
  // ---------------------------------------------------------------------------
  async function createPipeline() {
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New pipeline', enabled: true, nodes: [], connections: [] })
      });
      const data = await res.json();
      await loadPipelines();
      openPipeline(data.pipeline.id);
    } catch (e) {
      alert('Failed to create pipeline: ' + e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Save current pipeline
  // ---------------------------------------------------------------------------
  async function savePipeline() {
    if (!current) return;
    current.name = pipelineNameInput.value.trim() || 'Unnamed';
    current.enabled = pipelineEnabled.checked;
    setStatus('Saving...');
    try {
      const res = await fetch('/api/pipelines/' + encodeURIComponent(current.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current)
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      // Update local list
      const idx = pipelines.findIndex(p => p.id === current.id);
      if (idx !== -1) pipelines[idx] = JSON.parse(JSON.stringify(current));
      renderPipelineList();
      setStatus('Saved.');
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Run current pipeline
  // ---------------------------------------------------------------------------
  async function runNow() {
    if (!current) return;
    await savePipeline();
    setStatus('Running…');
    try {
      const res = await fetch('/api/pipelines/' + encodeURIComponent(current.id) + '/run', { method: 'POST' });
      const data = await res.json();
      setStatus('');
      showRunResult(data);
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  function showRunResult(data) {
    // Remove any existing result panel
    const existing = document.getElementById('runResultPanel');
    if (existing) existing.remove();
    const panel = document.createElement('div');
    panel.id = 'runResultPanel';
    panel.className = 'run-result';
    panel.innerHTML = `
      <h4>RUN RESULT <button class="close-btn" id="closeRunResult">✕</button></h4>
      <pre>${escapeHtml(data.ok ? JSON.stringify(data.context, null, 2) : ('Error: ' + (data.error || 'Unknown error')))}</pre>
    `;
    document.getElementById('canvasContainer').appendChild(panel);
    panel.querySelector('#closeRunResult').addEventListener('click', () => panel.remove());
  }

  // ---------------------------------------------------------------------------
  // Add node helpers
  // ---------------------------------------------------------------------------
  function nextNodePos() {
    if (!current || !current.nodes.length) return { x: 60, y: 160 };
    const last = current.nodes[current.nodes.length - 1];
    return { x: last.x + 200, y: last.y };
  }

  function addNode(defaults) {
    if (!current) return;
    const pos = nextNodePos();
    const node = { id: nodeId(), x: pos.x, y: pos.y, ...defaults };
    current.nodes.push(node);
    renderNode(node);
    redrawConnections();
    selectNode(node.id);
  }

  document.getElementById('addTriggerBtn').addEventListener('click', () =>
    addNode({ type: 'trigger', triggerType: 'schedule', schedule: '0 8 * * *', label: 'Trigger' }));
  document.getElementById('addSkillBtn').addEventListener('click', () =>
    addNode({ type: 'skill', skillId: '', args: {}, outputVar: 'result' }));
  document.getElementById('addPromptBtn').addEventListener('click', () =>
    addNode({ type: 'prompt', prompt: 'Summarize: {{result}}', outputVar: 'summary' }));
  document.getElementById('addIfBtn').addEventListener('click', () =>
    addNode({ type: 'if', expression: 'context.payload && context.payload.ok === true' }));
  document.getElementById('addEmailBtn').addEventListener('click', () =>
    addNode({ type: 'email', subject: 'Pipeline result', body: '{{summary}}' }));
  document.getElementById('addWebhookOutBtn').addEventListener('click', () =>
    addNode({ type: 'webhook_out', url: '', bodyTemplate: '{"result":"{{summary}}"}', outputVar: 'webhookStatus' }));

  // ---------------------------------------------------------------------------
  // Button listeners
  // ---------------------------------------------------------------------------
  newPipelineBtn.addEventListener('click', createPipeline);
  emptyNewBtn.addEventListener('click', createPipeline);
  savePipelineBtn.addEventListener('click', savePipeline);
  runNowBtn.addEventListener('click', runNow);

  pipelineNameInput.addEventListener('input', () => {
    if (current) current.name = pipelineNameInput.value;
    renderPipelineList();
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  loadPipelines();
})();
