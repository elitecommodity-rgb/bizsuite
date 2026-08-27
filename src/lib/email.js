// Pluggable client-emailing adapter.
//
// If SMTP_HOST is configured (env vars), real email is sent via nodemailer.
// Otherwise every "send" is logged (to the console and the email_logs table)
// as a PREVIEW so the whole quote/invoice-emailing flow works end-to-end
// out of the box, with zero external accounts required to demo it. Wiring
// up a real SMTP provider later is a config change, not a code change.

const { run, newId } = require('../db');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.toEmail
 * @param {string} opts.subject
 * @param {string} opts.body - HTML body
 * @param {string} [opts.relatedType] - e.g. 'quote' | 'invoice'
 * @param {string} [opts.relatedId]
 */
async function sendClientEmail({ tenantId, toEmail, subject, body, relatedType, relatedId }) {
  const t = getTransporter();
  let status = 'PREVIEW';
  let error = null;

  if (t) {
    try {
      await t.sendMail({
        from: process.env.SMTP_FROM || 'BizSuite <no-reply@example.com>',
        to: toEmail,
        subject,
        html: body,
      });
      status = 'SENT';
    } catch (err) {
      status = 'FAILED';
      error = err.message;
    }
  } else {
    // No SMTP configured — treat as a logged preview, not a failure.
    console.log(`[email:preview] to=${toEmail} subject="${subject}"`);
  }

  run(
    `INSERT INTO email_logs (id, tenant_id, to_email, subject, body, related_type, related_id, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId('eml'), tenantId, toEmail, subject, body, relatedType || null, relatedId || null, status, error]
  );

  return { status, error };
}

module.exports = { sendClientEmail, isLiveEmailConfigured: () => !!process.env.SMTP_HOST };
