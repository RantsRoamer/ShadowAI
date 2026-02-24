(function () {
  const personalityEl = document.getElementById('personality');
  const memoryEl = document.getElementById('memory');
  const behaviorEl = document.getElementById('behavior');
  const savePersonalityBtn = document.getElementById('savePersonality');
  const saveMemoryBtn = document.getElementById('saveMemory');
  const saveBehaviorBtn = document.getElementById('saveBehavior');
  const personalityStatus = document.getElementById('personalityStatus');
  const memoryStatus = document.getElementById('memoryStatus');
  const behaviorStatus = document.getElementById('behaviorStatus');

  function setStatus(el, msg, isError) {
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  async function load() {
    try {
      const [p, m, b] = await Promise.all([
        fetch('/api/personality').then(r => r.json()),
        fetch('/api/memory').then(r => r.json()),
        fetch('/api/behavior').then(r => r.json())
      ]);
      personalityEl.value = p.content ?? '';
      memoryEl.value = m.content ?? '';
      behaviorEl.value = b.content ?? '';
    } catch (e) {
      setStatus(personalityStatus, e.message, true);
    }
  }

  savePersonalityBtn.addEventListener('click', async () => {
    setStatus(personalityStatus, 'Saving...');
    try {
      const res = await fetch('/api/personality', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: personalityEl.value })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setStatus(personalityStatus, 'Saved.');
    } catch (e) {
      setStatus(personalityStatus, e.message, true);
    }
  });

  saveMemoryBtn.addEventListener('click', async () => {
    setStatus(memoryStatus, 'Saving...');
    try {
      const res = await fetch('/api/memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: memoryEl.value })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setStatus(memoryStatus, 'Saved.');
    } catch (e) {
      setStatus(memoryStatus, e.message, true);
    }
  });

  saveBehaviorBtn.addEventListener('click', async () => {
    setStatus(behaviorStatus, 'Saving...');
    try {
      const res = await fetch('/api/behavior', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: behaviorEl.value })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setStatus(behaviorStatus, 'Saved.');
    } catch (e) {
      setStatus(behaviorStatus, e.message, true);
    }
  });

  // ---------- Structured memory ----------
  const smBody = document.getElementById('smBody');
  const smNewKey = document.getElementById('smNewKey');
  const smNewValue = document.getElementById('smNewValue');
  const smAddBtn = document.getElementById('smAddBtn');
  const saveStructuredMemory = document.getElementById('saveStructuredMemory');
  const smStatus = document.getElementById('smStatus');

  function setSmStatus(msg, isError) {
    smStatus.textContent = msg;
    smStatus.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  function escapeHtml(s) {
    const el = document.createElement('div');
    el.textContent = String(s ?? '');
    return el.innerHTML;
  }

  function renderSmRow(key, value) {
    const tr = document.createElement('tr');
    tr.dataset.key = key;
    tr.innerHTML = `<td><code>${escapeHtml(key)}</code></td><td><input type="text" class="sm-val-input" value="${escapeHtml(value)}" style="width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:2px;color:var(--text-bright);padding:3px 6px;font-size:12px;" /></td><td><button type="button" class="sm-del-btn" title="Delete">×</button></td>`;
    tr.querySelector('.sm-del-btn').addEventListener('click', () => tr.remove());
    return tr;
  }

  async function loadStructuredMemory() {
    try {
      const res = await fetch('/api/structured-memory');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      smBody.innerHTML = '';
      Object.entries(data.facts || {}).forEach(([k, v]) => smBody.appendChild(renderSmRow(k, v)));
    } catch (e) {
      setSmStatus(e.message, true);
    }
  }

  smAddBtn.addEventListener('click', () => {
    const key = smNewKey.value.trim();
    const value = smNewValue.value.trim();
    if (!key) return;
    smBody.appendChild(renderSmRow(key, value));
    smNewKey.value = '';
    smNewValue.value = '';
  });

  saveStructuredMemory.addEventListener('click', async () => {
    const facts = {};
    smBody.querySelectorAll('tr').forEach(tr => {
      const key = tr.dataset.key;
      const val = tr.querySelector('.sm-val-input')?.value ?? '';
      if (key) facts[key] = val;
    });
    setSmStatus('Saving...');
    try {
      const res = await fetch('/api/structured-memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSmStatus('Saved.');
    } catch (e) {
      setSmStatus(e.message, true);
    }
  });

  load();
  loadStructuredMemory();
})();
