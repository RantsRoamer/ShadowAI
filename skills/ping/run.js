const { spawn } = require('child_process');
const os = require('os');

// Only allow valid hostnames/IPs — prevents shell injection
const HOST_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Ping skill: run ping against a host.
 * Args: { host: string, count?: number }
 * Windows uses -n, Unix uses -c.
 */
function run(args) {
  return new Promise((resolve) => {
    const host = args && args.host ? String(args.host).trim() : '';
    if (!host) {
      return resolve({ error: 'Missing host. Use: /skill ping {"host":"10.69.69.5"}' });
    }
    if (!HOST_REGEX.test(host)) {
      return resolve({ error: 'Invalid host: only alphanumeric characters, dots, hyphens, and underscores are allowed.' });
    }
    const count = Math.min(100, Math.max(1, parseInt(args && args.count, 10) || 4));
    const isWin = os.platform() === 'win32';
    // Use spawn with an args array — no shell interpolation, no injection risk
    const pingArgs = isWin ? ['-n', String(count), host] : ['-c', String(count), host];
    const proc = spawn('ping', pingArgs, { timeout: 30000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        return resolve({ error: 'Ping failed', stderr: stderr.trim(), stdout: stdout.trim() });
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.on('error', (err) => {
      resolve({ error: err.message, stdout: '', stderr: '' });
    });
  });
}

module.exports = { run };
