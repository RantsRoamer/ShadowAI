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

  load();
})();
