"use strict";

const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { domainFromFromHeader } = require("./mailAddresses");

function mailConfigured() {
  const from = String(process.env.MAIL_FROM || "").trim();
  if (!from) return false;
  const host = String(process.env.SMTP_HOST || "").trim();
  if (host) return true;
  const sg = String(
    process.env.SENDGRID_API_KEY || process.env.TWILIO_SENDGRID_API_KEY || "",
  ).trim();
  return sg.length > 0;
}

/** FQDN for SMTP EHLO — receivers (including Gmail) prefer this aligned with your sending domain, not the VPS hostname. */
function ehloHostname() {
  const explicit = String(process.env.SMTP_EHLO_HOSTNAME || "").trim();
  if (explicit) return explicit;
  return domainFromFromHeader(process.env.MAIL_FROM);
}

function smtpHostIsLoopback(host) {
  const h = String(host || "").trim().toLowerCase();
  return h === "127.0.0.1" || h === "[::1]" || h === "::1" || h === "localhost";
}

function createTransport() {
  if (!mailConfigured()) return null;

  const ehloName = ehloHostname();

  if (process.env.SMTP_HOST) {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === "1" || port === 465;
    const user = process.env.SMTP_USER;
    /** @type {Parameters<typeof nodemailer.createTransport>[0]} */
    const opts = {
      host,
      port,
      secure,
      auth: user ? { user, pass: process.env.SMTP_PASS || "" } : undefined,
    };
    if (ehloName.includes(".")) {
      opts.name = ehloName;
    }
    const loopback = smtpHostIsLoopback(host);
    if (!loopback) {
      opts.requireTLS = true;
      opts.tls = { minVersion: "TLSv1.2", servername: String(host).trim() };
    }
    return nodemailer.createTransport(opts);
  }

  const apiKey = String(
    process.env.SENDGRID_API_KEY || process.env.TWILIO_SENDGRID_API_KEY || "",
  ).trim();

  /** @type {Parameters<typeof nodemailer.createTransport>[0]} */
  const sgOpts = {
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    auth: {
      user: "apikey",
      pass: apiKey,
    },
    requireTLS: true,
    tls: { minVersion: "TLSv1.2", servername: "smtp.sendgrid.net" },
  };
  if (ehloName.includes(".")) {
    sgOpts.name = ehloName;
  }
  return nodemailer.createTransport(sgOpts);
}

/**
 * @param {{
 *   to: string,
 *   subject: string,
 *   html: string,
 *   text: string,
 *   from?: string,
 *   attachments?: object[],
 * }} opts
 * @returns {Promise<{ skipped?: boolean, messageId?: string }>}
 */
async function sendMail(opts) {
  const transport = createTransport();
  if (!transport) {
    console.warn(
      "[mail] Not configured (set MAIL_FROM plus SMTP_HOST or SENDGRID_API_KEY); skipping:",
      opts.subject,
      "→",
      opts.to,
    );
    return { skipped: true };
  }

  const from = (opts.from != null && String(opts.from).trim()
    ? String(opts.from).trim()
    : process.env.MAIL_FROM);
  if (!from) {
    console.warn("[mail] No From address; skipping:", opts.subject);
    return { skipped: true };
  }

  const domain =
    domainFromFromHeader(from) || domainFromFromHeader(process.env.MAIL_FROM);
  const messageId =
    domain.includes(".") ? `<${crypto.randomUUID()}@${domain}>` : undefined;

  /** @type {Parameters<typeof transport.sendMail>[0]} */
  const envelope = {
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  };
  if (messageId) {
    envelope.messageId = messageId;
  }
  if (opts.attachments && opts.attachments.length > 0) {
    envelope.attachments = opts.attachments;
  }
  const info = await transport.sendMail(envelope);

  console.info("[mail] sent:", opts.subject, "→", opts.to, info.messageId ? "(" + info.messageId + ")" : "");

  return { messageId: info.messageId };
}

module.exports = {
  mailConfigured,
  sendMail,
};
