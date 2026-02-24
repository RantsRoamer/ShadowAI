(function () {
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
