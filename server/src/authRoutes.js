"use strict";

const crypto = require("crypto");
const express = require("express");
const argon2 = require("argon2");
const { pool } = require("./db");
const { sendMail, mailConfigured } = require("./mail");
const { passwordResetEmail, registrationOtpEmail } = require("./emailTemplates");
const { sendSms, smsConfigured, normalizeTo } = require("./sms");
const { SIGNATURE_LOGO_CID, bannerLogoPngAttachment } = require("./emailSignatureLogo");

const router = express.Router();

const MIN_PASSWORD = 8;
const MIN_REGISTER_PASSWORD = 12;
const MAX_PASSWORD = 256;
const RESET_TTL_MS = 60 * 60 * 1000;
/** Registration / resend verification OTP lifetime (email + SMS). */
const OTP_TTL_MS = 2 * 60 * 1000;
/** Same window (seconds) for abandoning accounts with no OTP row (e.g. after a send failure). */
const OTP_TTL_SEC = Math.max(1, Math.floor(OTP_TTL_MS / 1000));
const MIN_OTP_SEND_GAP_MS = 45 * 1000;
const MAX_OTP_ATTEMPTS = 8;
const E164_PHONE = /^\+[1-9]\d{7,14}$/;

function publicOrigin() {
  const o = process.env.PUBLIC_ORIGIN || process.env.APP_PUBLIC_URL || "";
  const s = String(o).trim().replace(/\/$/, "");
  if (s) return s;
  const port = process.env.PORT || 3000;
  return "http://localhost:" + port;
}

/** Base URL for password-reset emails when PUBLIC_ORIGIN is unset (trust nginx forward headers first). */
function publicSiteOrigin(req) {
  const fromEnv = String(process.env.PUBLIC_ORIGIN || process.env.APP_PUBLIC_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  if (process.env.TRUST_PROXY === "1" && req) {
    const xfProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const xfHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    const host = xfHost || String(req.headers.host || "").trim();
    if (host) {
      let proto =
        xfProto === "http" || xfProto === "https"
          ? xfProto
          : req.secure
            ? "https"
            : "http";
      if (!xfProto && String(host).includes("localhost")) {
        proto = "http";
      }
      return `${proto}://${host}`;
    }
  }

  return publicOrigin();
}

/** Same inline banner as Messages replies: CID PNG from static SVG, else public SVG URL. */
async function bannerLogoForMailAttachments() {
  const logoAttach = await bannerLogoPngAttachment();
  const originBase = publicOrigin();
  const fallbackSvgUrl = originBase ? `${originBase}/email-banner-logo-static.svg` : "";
  const bannerLogoSrc = logoAttach ? `cid:${SIGNATURE_LOGO_CID}` : fallbackSvgUrl;
  return {
    attachments: logoAttach ? [logoAttach] : undefined,
    bannerLogoSrc,
  };
}

function hashResetToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function otpPepper() {
  return (
    process.env.REGISTRATION_OTP_PEPPER ||
    process.env.SESSION_SECRET ||
    "dev-registration-otp-pepper-change-me"
  );
}

function hashSignupOtp(userId, codeDigits) {
  const payload = `${userId}:${codeDigits}:${otpPepper()}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function normalizeOtpCodeInput(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length !== 6) return null;
  return d;
}

function generateSixDigitOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Remove unverified users whose signup code window has ended so the email can be registered again.
 * Deletes when every OTP row has expired, or when there are no OTP rows and the account is older than OTP_TTL_MS.
 */
async function deleteStalePendingRegistrations(db = pool) {
  const r = await db.query(
    `DELETE FROM users u
     WHERE u.email_verified_at IS NULL
       AND (
         (
           EXISTS (SELECT 1 FROM registration_otps ro WHERE ro.user_id = u.id)
           AND NOT EXISTS (
             SELECT 1 FROM registration_otps ro2
             WHERE ro2.user_id = u.id AND ro2.expires_at > NOW()
           )
         )
         OR
         (
           NOT EXISTS (SELECT 1 FROM registration_otps ro WHERE ro.user_id = u.id)
           AND u.created_at < NOW() - ($1::int * INTERVAL '1 second')
         )
       )`,
    [OTP_TTL_SEC],
  );
  if (r.rowCount > 0) {
    console.info(
      `[auth] deleted ${r.rowCount} unverified account(s) (registration not confirmed within OTP window)`,
    );
  }
  return r.rowCount;
}

/**
 * @param {boolean} isResend - if true, this issuance counts toward MIN_OTP_SEND_GAP_MS (not the initial /register OTP).
 */
async function replaceRegistrationOtp(client, userId, channel, smsDestination, plainCode, isResend) {
  const codeHash = hashSignupOtp(userId, plainCode);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await client.query(`DELETE FROM registration_otps WHERE user_id = $1`, [userId]);
  await client.query(
    `INSERT INTO registration_otps (user_id, code_hash, expires_at, channel, sms_destination, is_resend)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, codeHash, expiresAt, channel, smsDestination, !!isResend],
  );
}

/** Send signup OTP by email or SMS; does not touch the database. */
async function deliverRegistrationOtpMessage(user, channel, smsDestination, plainCode) {
  if (channel === "email") {
    const { attachments, bannerLogoSrc } = await bannerLogoForMailAttachments();
    const tmpl = registrationOtpEmail({
      displayName: user.name,
      code: plainCode,
      bannerLogoSrc,
    });
    try {
      const mailResult = await sendMail({
        to: user.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        attachments,
      });
      if (mailResult.skipped) {
        return { ok: false, error: "Email delivery is not configured (set MAIL_FROM and SMTP or SendGrid)." };
      }
    } catch (mailErr) {
      console.error("[mail] registration OTP:", mailErr);
      return { ok: false, error: "Could not send verification email. Try again later." };
    }
    return { ok: true };
  }
  const smsResult = await sendSms({
    to: smsDestination,
    body: `Zack's Maids verification code: ${plainCode}. Expires in 2 minutes.`,
  });
  if (smsResult.skipped || smsResult.error) {
    console.warn("[sms] registration OTP:", smsResult.error || "skipped");
    return {
      ok: false,
      error: smsResult.error || "Could not send SMS. Check Twilio configuration.",
    };
  }
  return { ok: true };
}

/**
 * Uses DB `NOW()` vs `registration_otps.created_at` — avoids indefinite rate-limit when Postgres
 * and Node wall clocks drift (comparison with `Date.now()` can stay stuck “too recent”).
 * Only rows with is_resend count (initial signup OTP from /register does not).
 */
async function sendGapOk(userId) {
  const r = await pool.query(
    `SELECT COALESCE(
       (
         SELECT MAX(ro.created_at) > (NOW() - (($2::numeric / 1000.0) * INTERVAL '1 second'))
         FROM registration_otps ro
         WHERE ro.user_id = $1 AND ro.is_resend = TRUE
       ),
       FALSE
     ) AS too_recent`,
    [userId, MIN_OTP_SEND_GAP_MS],
  );
  return !r.rows[0].too_recent;
}

/** Argon2id for newly registered passwords (library defaults are reasonable). */
const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

function validateEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

async function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTS);
}

async function verifyStoredPassword(plain, storedHash) {
  if (!storedHash || typeof storedHash !== "string") {
    return false;
  }
  try {
    return await argon2.verify(storedHash, plain);
  } catch {
    return false;
  }
}

const DEFAULT_ADMIN_USERNAME = "zacksadmin";
const DEFAULT_ADMIN_PASSWORD = "cleaning12345";

function adminEffectivePassword() {
  const p = process.env.ADMIN_PASSWORD;
  if (typeof p === "string" && p.length > 0) return p;
  return DEFAULT_ADMIN_PASSWORD;
}

/**
 * Login identifiers that receive env (or default) ADMIN_PASSWORD.
 * Default username is `zacksadmin`; optional ADMIN_USERNAME replaces that default (not additive).
 * ADMIN_EMAIL adds a second valid identifier when set.
 */
function adminLoginIdentifiers() {
  const ids = new Set();
  const u = process.env.ADMIN_USERNAME;
  if (typeof u === "string" && u.trim()) {
    ids.add(u.trim().toLowerCase());
  } else {
    ids.add(DEFAULT_ADMIN_USERNAME.toLowerCase());
  }
  const e = process.env.ADMIN_EMAIL;
  if (typeof e === "string" && e.trim()) {
    ids.add(e.trim().toLowerCase());
  }
  return ids;
}

function adminCredentialsMatch(identifier, password) {
  const id = String(identifier || "").trim().toLowerCase();
  if (!id || password !== adminEffectivePassword()) return false;
  return adminLoginIdentifiers().has(id);
}

router.post("/register", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    const name = req.body.name ? String(req.body.name).trim() || null : null;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email." });
    }
    if (password.length < MIN_REGISTER_PASSWORD || password.length > MAX_PASSWORD) {
      return res.status(400).json({
        error:
          "Password must be between " + MIN_REGISTER_PASSWORD + " and " + MAX_PASSWORD + " characters.",
      });
    }

    if (!mailConfigured()) {
      return res.status(503).json({
        error:
          "Registration needs outbound email. On the server, set a non-empty MAIL_FROM and either SMTP_HOST (e.g. 127.0.0.1:25 for local Postfix) or SENDGRID_API_KEY in the repository .env, then restart zacks-maids-node. See .env.example.",
      });
    }

    await deleteStalePendingRegistrations();

    const password_hash = await hashPassword(password);
    const plainCode = generateSixDigitOtp();

    const client = await pool.connect();
    let user;
    try {
      await client.query("BEGIN");
      let insert;
      try {
        insert = await client.query(
          `INSERT INTO users (email, password_hash, name)
           VALUES ($1::citext, $2, $3)
           RETURNING id, email, name`,
          [email, password_hash, name],
        );
      } catch (err) {
        await client.query("ROLLBACK");
        if (err.code === "23505") {
          return res.status(409).json({ error: "That email is already registered." });
        }
        throw err;
      }
      user = insert.rows[0];
      await replaceRegistrationOtp(client, user.id, "email", null, plainCode, false);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const sent = await deliverRegistrationOtpMessage(user, "email", null, plainCode);
    if (!sent.ok) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
      return res.status(503).json({ error: sent.error });
    }

    res.status(201).json({
      ok: true,
      requiresVerification: true,
      email: user.email,
      verificationSent: "email",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not register." });
  }
});

router.post("/send-registration-code", async (req, res) => {
  try {
    await deleteStalePendingRegistrations();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const channel = String(req.body.channel || "").toLowerCase();
    const phoneRaw = req.body.phone != null ? String(req.body.phone) : "";

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email." });
    }
    if (channel !== "email" && channel !== "sms") {
      return res.status(400).json({ error: "Choose email or SMS verification." });
    }

    const q = await pool.query(
      `SELECT id, email, name, email_verified_at FROM users WHERE email = $1::citext LIMIT 1`,
      [email],
    );

    const generic = {
      ok: true,
      message: "If that account exists and is not verified yet, we sent a code.",
    };

    if (q.rows.length === 0 || q.rows[0].email_verified_at) {
      return res.json(generic);
    }

    const user = q.rows[0];

    if (!(await sendGapOk(user.id))) {
      return res.status(429).json({
        error: "Please wait about a minute before requesting another code.",
      });
    }

    let smsDestination = null;
    if (channel === "email") {
      if (!mailConfigured()) {
        return res.status(503).json({
          error:
            "Email delivery is not configured (set MAIL_FROM and SMTP_HOST or SendGrid in .env).",
        });
      }
    } else {
      if (!smsConfigured()) {
        return res.status(503).json({
          error: "SMS verification is not available on this server (Twilio not configured).",
        });
      }
      const to = normalizeTo(phoneRaw);
      if (!to || !E164_PHONE.test(to)) {
        return res.status(400).json({
          error: "Enter a valid mobile number with country code (e.g. +15551234567).",
        });
      }
      smsDestination = to;
    }

    const plainCode = generateSixDigitOtp();

    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      await replaceRegistrationOtp(dbClient, user.id, channel, smsDestination, plainCode, true);
      await dbClient.query("COMMIT");
    } catch (inner) {
      await dbClient.query("ROLLBACK").catch(() => {});
      throw inner;
    } finally {
      dbClient.release();
    }

    const delivered = await deliverRegistrationOtpMessage(user, channel, smsDestination, plainCode);
    if (!delivered.ok) {
      await pool.query(`DELETE FROM registration_otps WHERE user_id = $1`, [user.id]);
      return res.status(503).json({ error: delivered.error });
    }

    res.json({
      ok: true,
      message:
        channel === "email"
          ? "We emailed a 6-digit code to your address."
          : "We sent a 6-digit code by SMS.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not send verification code." });
  }
});

router.post("/verify-registration-code", async (req, res) => {
  try {
    await deleteStalePendingRegistrations();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const code = normalizeOtpCodeInput(req.body.code);

    if (!validateEmail(email) || !code) {
      return res.status(400).json({ error: "Enter your email and the 6-digit code." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const u = await client.query(
        `SELECT id, email, name FROM users WHERE email = $1::citext AND email_verified_at IS NULL LIMIT 1`,
        [email],
      );
      if (u.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid code or account already verified." });
      }
      const user = u.rows[0];

      const o = await client.query(
        `SELECT id, code_hash, attempts FROM registration_otps
         WHERE user_id = $1 AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1
         FOR UPDATE`,
        [user.id],
      );
      if (o.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No active code. Request a new one." });
      }
      const row = o.rows[0];
      if (row.attempts >= MAX_OTP_ATTEMPTS) {
        await client.query("ROLLBACK");
        return res.status(429).json({ error: "Too many attempts. Request a new code." });
      }

      const expectHash = hashSignupOtp(user.id, code);
      if (expectHash !== row.code_hash) {
        await client.query(`UPDATE registration_otps SET attempts = attempts + 1 WHERE id = $1`, [
          row.id,
        ]);
        await client.query("COMMIT");
        return res.status(400).json({ error: "Incorrect code." });
      }

      await client.query(
        `UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1`,
        [user.id],
      );
      await client.query(`DELETE FROM registration_otps WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [user.id]);
      await client.query("COMMIT");

      delete req.session.isAdmin;
      req.session.userId = user.id;
      req.session.email = user.email;
      await pool.query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [
        user.id,
      ]);

      res.json({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (inner) {
      await client.query("ROLLBACK").catch(() => {});
      throw inner;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify code." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const rawId = String(req.body.email || "").trim();
    const password = String(req.body.password || "");

    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    if (adminCredentialsMatch(rawId, password)) {
      delete req.session.userId;
      req.session.isAdmin = true;
      req.session.email = rawId.toLowerCase();
      return res.json({
        ok: true,
        isAdmin: true,
        user: { id: null, email: req.session.email, name: "Administrator" },
      });
    }

    const email = rawId.toLowerCase();
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    await deleteStalePendingRegistrations();

    const q = await pool.query(
      `SELECT id, email, name, password_hash, email_verified_at FROM users WHERE email = $1::citext LIMIT 1`,
      [email],
    );
    if (q.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = q.rows[0];
    const ok = await verifyStoredPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.email_verified_at) {
      return res.status(403).json({
        error:
          "Please verify your email before signing in. Complete signup with the code we sent, or request a new code from the registration confirmation page.",
      });
    }

    delete req.session.isAdmin;
    req.session.userId = user.id;
    req.session.email = user.email;
    await pool.query(
      `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
      [user.id],
    );
    res.json({
      ok: true,
      isAdmin: false,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not sign in." });
  }
});

router.post("/verify-email", async (req, res) => {
  try {
    const rawToken = String(req.body.token || "").trim();
    if (!rawToken) {
      return res.status(400).json({ error: "Missing verification token." });
    }

    const tokenHash = hashResetToken(rawToken);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT user_id FROM email_verification_tokens
         WHERE token_hash = $1 AND expires_at > now() LIMIT 1`,
        [tokenHash],
      );
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This verification link is invalid or has expired." });
      }

      const userId = r.rows[0].user_id;
      await client.query(
        `UPDATE users SET email_verified_at = now(), updated_at = now()
         WHERE id = $1 AND email_verified_at IS NULL`,
        [userId],
      );
      await client.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
      await client.query("COMMIT");

      const u = await pool.query(`SELECT id, email, name FROM users WHERE id = $1 LIMIT 1`, [userId]);
      if (u.rows.length === 0) {
        return res.status(500).json({ error: "Account not found after verification." });
      }
      const row = u.rows[0];

      delete req.session.isAdmin;
      req.session.userId = row.id;
      req.session.email = row.email;
      await pool.query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [
        row.id,
      ]);

      res.json({
        ok: true,
        user: { id: row.id, email: row.email, name: row.name },
      });
    } catch (inner) {
      await client.query("ROLLBACK").catch(() => {});
      throw inner;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify email." });
  }
});

router.post("/resend-verification", async (req, res) => {
  try {
    await deleteStalePendingRegistrations();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    const q = await pool.query(
      `SELECT id, email, name, email_verified_at FROM users WHERE email = $1::citext LIMIT 1`,
      [email],
    );

    const generic = {
      ok: true,
      message: "If an unverified account exists for that address, we sent a new verification code.",
    };

    if (q.rows.length === 0 || q.rows[0].email_verified_at) {
      return res.json(generic);
    }

    const user = q.rows[0];

    if (!(await sendGapOk(user.id))) {
      return res.status(429).json({
        error: "Please wait about a minute before requesting another code.",
      });
    }

    if (!mailConfigured()) {
      console.warn("[mail] resend-verification: mail not configured for", user.email);
      return res.json(generic);
    }

    const plainCode = generateSixDigitOtp();
    const codeHash = hashSignupOtp(user.id, plainCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const { attachments, bannerLogoSrc } = await bannerLogoForMailAttachments();
    const tmpl = registrationOtpEmail({
      displayName: user.name,
      code: plainCode,
      bannerLogoSrc,
    });

    try {
      const mr = await sendMail({
        to: user.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        attachments,
      });
      if (mr.skipped) {
        console.warn("[mail] resend-verification skipped for", user.email);
        return res.json(generic);
      }
    } catch (mailErr) {
      console.error("[mail] resend-verification:", mailErr);
      return res.json(generic);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM registration_otps WHERE user_id = $1`, [user.id]);
      await client.query(
        `INSERT INTO registration_otps (user_id, code_hash, expires_at, channel, sms_destination, is_resend)
         VALUES ($1, $2, $3, 'email', NULL, TRUE)`,
        [user.id, codeHash, expiresAt],
      );
      await client.query("COMMIT");
    } catch (inner) {
      await client.query("ROLLBACK").catch(() => {});
      throw inner;
    } finally {
      client.release();
    }

    res.json(generic);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not process request." });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(function (err) {
    if (err) {
      return res.status(500).json({ error: "Could not log out." });
    }
    res.clearCookie("sid", { path: "/" });
    res.json({ ok: true });
  });
});

router.post("/forgot-password", async (req, res) => {
  const genericReply = () => {
    res.json({
      ok: true,
      message: "If that email is registered, you will receive reset instructions shortly.",
    });
  };

  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    const q = await pool.query(`SELECT id, email FROM users WHERE email = $1::citext LIMIT 1`, [
      email,
    ]);

    if (q.rows.length === 0) {
      return genericReply();
    }

    const u = q.rows[0];
    const toAddr = String(u.email || "")
      .trim()
      .toLowerCase();

    if (!mailConfigured()) {
      console.error(
        "[auth] forgot-password: mail not configured (set MAIL_FROM and SMTP_* or SENDGRID_API_KEY)",
      );
      return genericReply();
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [u.id]);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [u.id, tokenHash, expiresAt],
    );

    const resetBase = publicSiteOrigin(req);
    const resetUrl =
      resetBase.replace(/\/+$/, "") + "/reset-password.html?token=" + encodeURIComponent(rawToken);

    let mailResult = /** @type {{ skipped?: boolean }} */ ({ skipped: true });
    try {
      const { attachments, bannerLogoSrc } = await bannerLogoForMailAttachments();
      const tmpl = passwordResetEmail({ resetUrl, bannerLogoSrc });
      mailResult = await sendMail({
        to: toAddr,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        attachments,
      });
    } catch (mailErr) {
      console.error("[auth] forgot-password: SMTP error for", toAddr, mailErr);
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [u.id]).catch(() => {});
      return genericReply();
    }

    if (mailResult.skipped) {
      console.warn("[auth] forgot-password: mail transport skipped delivery to", toAddr);
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [u.id]).catch(() => {});
    } else {
      console.info("[auth] forgot-password: reset mail queued/sent →", toAddr);
    }

    return genericReply();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not process request." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const rawToken = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    if (
      !rawToken ||
      password.length < MIN_REGISTER_PASSWORD ||
      password.length > MAX_PASSWORD
    ) {
      return res.status(400).json({
        error:
          "Invalid or expired link, or password must be between " +
          MIN_REGISTER_PASSWORD +
          " and " +
          MAX_PASSWORD +
          " characters.",
      });
    }

    const tokenHash = hashResetToken(rawToken);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > now() LIMIT 1`,
        [tokenHash],
      );
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This reset link is invalid or has expired." });
      }
      const userId = r.rows[0].user_id;
      const password_hash = await hashPassword(password);
      /* Mailbox proved via reset email — unblock login for accounts that never completed signup OTP */
      await client.query(
        `UPDATE users SET password_hash = $1,
           email_verified_at = COALESCE(email_verified_at, now()),
           updated_at = now()
         WHERE id = $2`,
        [password_hash, userId],
      );
      await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM registration_otps WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (inner) {
      await client.query("ROLLBACK");
      throw inner;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not reset password." });
  }
});

router.get("/me", async (req, res) => {
  try {
    if (req.session.isAdmin) {
      return res.json({
        loggedIn: true,
        isAdmin: true,
        user: {
          id: null,
          email: req.session.email || null,
          name: "Administrator",
        },
      });
    }
    if (!req.session.userId) {
      return res.json({ loggedIn: false, isAdmin: false });
    }
    const q = await pool.query(
      `SELECT id, email, name, email_verified_at FROM users WHERE id = $1 LIMIT 1`,
      [req.session.userId],
    );
    if (q.rows.length === 0) {
      return res.json({ loggedIn: false, isAdmin: false });
    }
    const u = q.rows[0];
    if (!u.email_verified_at) {
      req.session.destroy(function () {
        res.clearCookie("sid", { path: "/" });
        res.json({ loggedIn: false, isAdmin: false });
      });
      return;
    }
    return res.json({
      loggedIn: true,
      isAdmin: false,
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ loggedIn: false, isAdmin: false });
  }
});

module.exports = { router, deleteStalePendingRegistrations };
