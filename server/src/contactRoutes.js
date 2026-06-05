"use strict";

const express = require("express");
const { pool } = require("./db");
const { notifyInboxChanged } = require("./adminMessagesRealtime");
const {
  EMAIL_RE,
  NAME_CTRL_RE,
  trimStr,
  validatePhone,
  createHourlyIpLimiter,
} = require("./inputValidators");

const router = express.Router();

/** Printable ASCII + common whitespace (title is single-line: no CR/LF). */
const ASCII_TITLE_RE = /^[\x20-\x7E]+$/;
/** Printable ASCII + spaces, newlines, tabs only. */
const ASCII_BODY_RE = /^[\x20-\x7E\r\n\t]+$/;

const contactRateLimit = createHourlyIpLimiter(15);

router.post("/", contactRateLimit, async (req, res) => {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Send JSON (Content-Type: application/json)." });
  }

  const email = trimStr(req.body && req.body.email, 320);
  const name = trimStr(req.body && req.body.name, 200);
  const title = trimStr(req.body && req.body.title, 300);
  const body = trimStr(req.body && req.body.body, 10000);

  const phonePrefix =
    req.body && req.body.phonePrefix != null ? String(req.body.phonePrefix).trim() : "";
  const phoneNationalRaw = req.body && req.body.phoneNational != null ? req.body.phoneNational : "";

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (!name || NAME_CTRL_RE.test(name)) {
    return res.status(400).json({ error: "Please enter your name (no control characters)." });
  }
  if (!title || !ASCII_TITLE_RE.test(title)) {
    return res.status(400).json({
      error:
        "Message title must use plain ASCII letters, numbers, and punctuation only (no emoji or non-Latin characters).",
    });
  }
  if (!body || !ASCII_BODY_RE.test(body)) {
    return res.status(400).json({
      error:
        "Message must use plain ASCII only (line breaks are OK; no emoji or other Unicode).",
    });
  }

  const phoneCheck = validatePhone(phonePrefix, phoneNationalRaw);
  if (!phoneCheck.ok) {
    const suffix = phoneCheck.hint ? ` ${phoneCheck.hint}` : "";
    return res.status(400).json({
      error: `Invalid mobile number for the selected country code.${suffix}`,
    });
  }
  const mobile = phoneCheck.mobile;
  if (mobile.length > 24) {
    return res.status(400).json({ error: "Phone number is too long." });
  }

  try {
    const r = await pool.query(
      `
      INSERT INTO contact_messages (email, name, mobile, title, body)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at
    `,
      [email, name, mobile, title, body],
    );
    notifyInboxChanged();
    res.status(201).json({
      ok: true,
      message: r.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not send your message. Please try again later." });
  }
});

module.exports = { router };
