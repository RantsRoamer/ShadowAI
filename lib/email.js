const nodemailer = require('nodemailer');

/**
 * Send an email using the provided config.
 * @param {object} cfg - { host, port, secure, auth: { user, pass }, from, defaultTo }
 * @param {object} opts - { to?, subject, text, html? }
 */
async function sendMail(cfg, opts) {
  if (!cfg || !cfg.host || !String(cfg.host).trim()) {
    throw new Error('Email not configured: missing host');
  }
  const to = opts.to && String(opts.to).trim() ? opts.to.trim() : (cfg.defaultTo || '').trim();
  if (!to) throw new Error('No recipient: set default "To" in config or pass to');
  const subject = opts.subject != null ? String(opts.subject).trim() : '';
  const text = opts.text != null ? String(opts.text) : '';
  const html = opts.html != null ? String(opts.html) : undefined;

  const transportOpts = {
    host: String(cfg.host).trim(),
    port: Math.max(1, Math.min(65535, parseInt(cfg.port, 10) || 25)),
    secure: cfg.secure === true
  };
  if (cfg.auth && cfg.auth.user) {
    transportOpts.auth = {
      user: String(cfg.auth.user).trim(),
      pass: String(cfg.auth.pass || '').trim()
    };
  }

  const transporter = nodemailer.createTransport(transportOpts);
  const from = (cfg.from || '').trim() || 'ShadowAI <noreply@localhost>';
  const result = await transporter.sendMail({
    from,
    to,
    subject: subject || '(No subject)',
    text: text || '(No content)',
    html: html || undefined
  });
  return result;
}

module.exports = { sendMail };
