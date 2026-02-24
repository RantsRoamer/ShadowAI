(function () {
  const agentsList = document.getElementById('agentsList');
  const addAgentBtn = document.getElementById('addAgent');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderAgents(agents) {
    agentsList.innerHTML = '';
    const list = agents.length ? agents : [];
    list.forEach((a, i) => {
      const div = document.createElement('div');
      div.className = 'agent-block';
      div.innerHTML = `
        <div class="row">
          <div class="form-group">
            <label>ID</label>
            <input type="text" class="agent-id" value="${escapeAttr(a.id)}" placeholder="coding" />
          </div>
          <div class="form-group">
            <label>Name</label>
            <input type="text" class="agent-name" value="${escapeAttr(a.name)}" placeholder="Coding Agent" />
          </div>
        </div>
        <div class="row">
          <div class="form-group">
            <label>Ollama URL (empty = main)</label>
            <input type="text" class="agent-url" value="${escapeAttr(a.url || '')}" placeholder="http://localhost:11434" />
          </div>
        </div>
        <div class="row">
          <div class="form-group agent-model-group">
            <label>Model</label>
            <div class="input-with-btn">
              <input type="text" class="agent-model" value="${escapeAttr(a.model)}" placeholder="codellama" />
              <button type="button" class="btn btn-small agent-fetch-models">Fetch models</button>
            </div>
            <select class="model-list agent-model-list" style="display:none;"></select>
          </div>
        </div>
        <div class="row-end">
          <label><input type="checkbox" class="agent-enabled" ${a.enabled !== false ? 'checked' : ''} /> Enabled</label>
          <span class="remove-agent" data-index="${i}">Remove</span>
        </div>
      `;
      div.querySelector('.remove-agent').addEventListener('click', () => div.remove());
      div.querySelector('.agent-fetch-models').addEventListener('click', async () => {
        const urlInput = div.querySelector('.agent-url');
        const modelInput = div.querySelector('.agent-model');
        const modelSelect = div.querySelector('.agent-model-list');
        const url = urlInput.value.trim() || 'http://localhost:11434';
        const btn = div.querySelector('.agent-fetch-models');
        btn.disabled = true;
        try {
          const res = await fetch('/api/ollama/models?url=' + encodeURIComponent(url));
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          modelSelect.style.display = 'block';
          modelSelect.innerHTML = '<option value="">Select or type below</option>' +
            (data.models || []).map(m => '<option value="' + escapeAttr(m) + '">' + escapeAttr(m) + '</option>').join('');
          modelSelect.onchange = () => { if (modelSelect.value) modelInput.value = modelSelect.value; };
          setStatus('Loaded ' + (data.models?.length || 0) + ' models');
        } catch (e) {
          setStatus(e.message, true);
        }
        btn.disabled = false;
      });
      agentsList.appendChild(div);
    });
  }

  function getAgentsFromDom() {
    return Array.from(agentsList.querySelectorAll('.agent-block')).map(block => ({
      id: block.querySelector('.agent-id').value.trim() || 'agent',
      name: block.querySelector('.agent-name').value.trim() || 'Agent',
      url: block.querySelector('.agent-url').value.trim() || '',
      model: block.querySelector('.agent-model').value.trim() || '',
      enabled: block.querySelector('.agent-enabled').checked
    }));
  }

  addAgentBtn.addEventListener('click', () => {
    const agents = getAgentsFromDom();
    agents.push({ id: 'agent', name: 'New Agent', url: '', model: '', enabled: true });
    renderAgents(agents);
  });

  saveBtn.addEventListener('click', async () => {
    const agents = getAgentsFromDom();
    setStatus('Saving...');
    try {
      // Fetch current ollama config to preserve mainUrl/mainModel/etc
      const cfgRes = await fetch('/api/config');
      if (!cfgRes.ok) throw new Error('Could not load config');
      const cfg = await cfgRes.json();
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollama: {
            mainUrl: cfg.ollama?.mainUrl || 'http://localhost:11434',
            mainModel: cfg.ollama?.mainModel || 'llama3.2',
            temperature: cfg.ollama?.temperature ?? 0.7,
            num_predict: cfg.ollama?.num_predict ?? 2048,
            agents
          }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      renderAgents(data.config?.ollama?.agents || agents);
      setStatus('Saved.');
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  async function load() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(res.statusText);
      const c = await res.json();
      renderAgents(c.ollama?.agents ?? []);
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  load();
})();
