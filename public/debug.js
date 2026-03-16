(function () {
  // ── Memory check ────────────────────────────────────────────────────────────
  const memoryResultEl  = document.getElementById('memoryResult');
  const memoryCheckBtn  = document.getElementById('memoryCheckBtn');
  const memoryFixBtn    = document.getElementById('memoryFixBtn');

  function renderMemoryResult(data) {
    if (data.error) { memoryResultEl.textContent = 'Error: ' + data.error; return; }
    const lines = [];
    for (const f of (data.files || [])) {
      const status = f.ok ? '✓' : '⚠';
      lines.push(`${status}  ${f.name}`);
      for (const issue of (f.issues || [])) lines.push(`     ${issue}`);
    }
    lines.push('');
    const idx = data.index || {};
    const idxStatus = idx.ok ? '✓' : '⚠';
    lines.push(`${idxStatus}  MEMORY.md  (${idx.lineCount || 0} lines)`);
    for (const issue of (idx.issues || [])) lines.push(`     ${issue}`);
    lines.push('');
    if (data.totalIssues === 0) {
      lines.push('All memory files look good.');
    } else {
      lines.push(`Found ${data.totalIssues} issue(s).`);
      if (data.fixed > 0) lines.push(`Applied ${data.fixed} fix(es).`);
    }
    memoryResultEl.textContent = lines.join('\n');
  }

  async function runMemoryCheck(fix) {
    memoryResultEl.textContent = fix ? 'Fixing…' : 'Checking…';
    memoryCheckBtn.disabled = true;
    memoryFixBtn.disabled   = true;
    try {
      const r = await fetch('/api/debug/memory' + (fix ? '/fix' : ''), {
        method: fix ? 'POST' : 'GET'
      });
      renderMemoryResult(await r.json());
    } catch (e) {
      memoryResultEl.textContent = 'Error: ' + e.message;
    }
    memoryCheckBtn.disabled = false;
    memoryFixBtn.disabled   = false;
  }

  memoryCheckBtn.addEventListener('click', () => runMemoryCheck(false));
  memoryFixBtn.addEventListener('click',   () => runMemoryCheck(true));

  // ── SearXNG ─────────────────────────────────────────────────────────────────
  const configEl = document.getElementById('searxngConfig');
  const resultEl = document.getElementById('searxngResult');
  const testQueryEl = document.getElementById('testQuery');
  const runTestBtn = document.getElementById('runTestBtn');

  async function loadConfig() {
    try {
      const res = await fetch('/api/debug/searxng');
      const data = await res.json();
      configEl.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      configEl.textContent = 'Error: ' + e.message;
    }
  }

  runTestBtn.addEventListener('click', async () => {
    const query = testQueryEl.value.trim() || 'hello world';
    resultEl.textContent = 'Running…';
    runTestBtn.disabled = true;
    try {
      const res = await fetch('/api/debug/searxng', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query })
      });
      const data = await res.json();
      resultEl.textContent = JSON.stringify(data, null, 2);
      loadConfig();
    } catch (e) {
      resultEl.textContent = 'Error: ' + e.message;
    }
    runTestBtn.disabled = false;
  });

  loadConfig();
})();
