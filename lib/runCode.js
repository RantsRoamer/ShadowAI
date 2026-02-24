const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const RUN_DIR = path.join(__dirname, '..', 'run');
const MAX_OUTPUT = 200 * 1024; // 200KB
const DEFAULT_TIMEOUT_MS = 30000;

function ensureRunDir() {
  if (!fs.existsSync(RUN_DIR)) fs.mkdirSync(RUN_DIR, { recursive: true });
}

function runCode(lang, code, timeoutMs = DEFAULT_TIMEOUT_MS) {
  ensureRunDir();
  const ext = { js: 'js', python: 'py', py: 'py', ts: 'ts' }[lang] || 'txt';
  const filename = `run_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const filepath = path.join(RUN_DIR, filename);
  fs.writeFileSync(filepath, code, 'utf8');

  return new Promise((resolve, reject) => {
    let cmd, args;
    const isWin = os.platform() === 'win32';
    if (lang === 'js' || lang === 'javascript') {
      cmd = 'node';
      args = [filepath];
    } else if (lang === 'python' || lang === 'py') {
      cmd = 'python';
      args = [filepath];
    } else if (lang === 'ts' || lang === 'typescript') {
      cmd = 'npx';
      args = ['ts-node', filepath];
    } else {
      try { fs.unlinkSync(filepath); } catch (_) {}
      return resolve({ stdout: '', stderr: `Unsupported language: ${lang}`, exitCode: -1 });
    }

    const proc = spawn(cmd, args, {
      cwd: RUN_DIR,
      shell: false,   // Never use shell — it splits paths on spaces (e.g. "N:\AI Projects\...")
      timeout: timeoutMs
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', d => { stdout += d; if (stdout.length > MAX_OUTPUT) proc.kill(); });
    proc.stderr?.on('data', d => { stderr += d; if (stderr.length > MAX_OUTPUT) proc.kill(); });
    proc.on('error', err => {
      try { fs.unlinkSync(filepath); } catch (_) {}
      resolve({ stdout, stderr: err.message, exitCode: -1 });
    });
    proc.on('close', (code, signal) => {
      try { fs.unlinkSync(filepath); } catch (_) {}
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT) + '\n...[truncated]';
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT) + '\n...[truncated]';
      resolve({ stdout, stderr, exitCode: code ?? -1, signal });
    });
  });
}

module.exports = { runCode, ensureRunDir, RUN_DIR };
