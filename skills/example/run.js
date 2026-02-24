/**
 * Example skill: returns current time.
 * Skills must export run(args) or module.exports = { run }.
 * No server reload needed when enabled in Skills page.
 */
async function run(args) {
  const t = new Date();
  return {
    iso: t.toISOString(),
    locale: t.toLocaleString(),
    unix: Math.floor(t.getTime() / 1000),
    ...(args && args.tz ? { timezone: args.tz } : {})
  };
}

module.exports = { run };
