// Runs as a forked child process to execute skills in isolation.
// Receives { skillPath, args } via IPC, runs the skill, replies with result.
process.on('message', async ({ skillPath, args }) => {
  try {
    const mod = require(skillPath);
    const run = typeof mod.run === 'function' ? mod.run : mod;
    if (typeof run !== 'function') throw new Error('Skill must export run(args)');
    const result = await Promise.resolve(run(args));
    process.send({ ok: true, result });
  } catch (e) {
    process.send({ ok: false, error: e.message });
  }
  process.exit(0);
});
