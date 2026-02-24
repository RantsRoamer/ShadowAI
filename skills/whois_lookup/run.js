module.exports = {
  /**
   * Run the WHOIS lookup.
   * @param {Object} args
   * @param {string} args.query  Domain or IP to look up
   * @returns {Promise<string>} WHOIS data or error message
   */
  async run(args) {
    const { query } = args;
    if (!query) {
      throw new Error('No query provided. Please supply a domain or IP.');
    }

    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    try {
      // Execute the 'whois' command; fallback to 'nslookup' if not available
      const { stdout, stderr } = await execAsync(`whois ${query}`);
      if (stderr) {
        return `WHOIS error: ${stderr}`;
      }
      return stdout || 'No WHOIS data returned.';
    } catch (err) {
      // Attempt with nslookup as a fallback
      try {
        const { stdout, stderr } = await execAsync(`nslookup -type=any ${query}`);
        if (stderr) {
          return `nslookup error: ${stderr}`;
        }
        return stdout || 'No nslookup data returned.';
      } catch (nsErr) {
        return `Lookup failed: ${err.message}`;
      }
    }
  }
};