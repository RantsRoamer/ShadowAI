const { spawn } = require('child_process');
const os = require('os');

// Only allow valid hostnames/IPs — prevents shell injection
const HOST_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Run traceroute against a target host.
 *
 * @param {Object} args
 * @param {string} args.host - Target host (IP or DNS name).
 * @param {number} [args.max_hops] - Optional maximum number of hops (default 30).
 * @returns {Promise<string>} - The traceroute output or error message.
 */
async function run(args) {
  const host = args && args.host ? String(args.host).trim() : '';
  if (!host) {
    throw new Error('Missing required argument: host');
  }
  if (!HOST_REGEX.test(host)) {
    throw new Error('Invalid host: only alphanumeric characters, dots, hyphens, and underscores are allowed.');
  }

  const maxHops = args.max_hops ? Number(args.max_hops) : 30;
  if (isNaN(maxHops) || maxHops <= 0 || maxHops > 255) {
    throw new Error('max_hops must be a positive number (1–255)');
  }

  const isWindows = os.platform() === 'win32';
  // Use spawn with an args array — no shell interpolation, no injection risk
  const cmd = isWindows ? 'tracert' : 'traceroute';
  const cmdArgs = isWindows
    ? ['-h', String(maxHops), host]
    : ['-m', String(maxHops), host];

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, { timeout: 60000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Traceroute failed: ${stderr.trim() || 'unknown error'}`));
      } else {
        resolve(stdout || stderr);
      }
    });
    proc.on('error', (err) => {
      reject(new Error(`Error running traceroute: ${err.message}`));
    });
  });
}

module.exports = { run };
