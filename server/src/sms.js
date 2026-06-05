"use strict";

const twilio = require("twilio");

function smsConfigured() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tokenAuth = process.env.TWILIO_AUTH_TOKEN;
  const keyAuth =
    process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET &&
    process.env.TWILIO_API_KEY_SECRET.length > 0;
  const from =
    process.env.TWILIO_FROM_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER ||
    process.env.TWILIO_FROM;
  const msid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  return !!(sid && (tokenAuth || keyAuth) && (from || msid));
}

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) return null;

  // Use Auth Token first when present. Restricted API keys without Messaging permissions
  // fail with: Authorization Error: actor doesn't have any assertions.
  if (process.env.TWILIO_AUTH_TOKEN) {
    return twilio(accountSid, process.env.TWILIO_AUTH_TOKEN);
  }
  if (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET) {
    return twilio(process.env.TWILIO_API_KEY_SID, process.env.TWILIO_API_KEY_SECRET, {
      accountSid,
    });
  }
  return null;
}

function normalizeTo(raw) {
  var s = String(raw || "").trim().replace(/[\s().-]/g, "");
  if (!s) return "";
  if (s[0] !== "+") {
    if (s.length === 10 && /^[2-9]\d{9}$/.test(s)) {
      s = "+1" + s;
    } else {
      s = "+" + s.replace(/^\+/, "");
    }
  }
  return s;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Twilio RestException exposes numeric `code` (e.g. 21608 trial / unverified destination).
 * @param {unknown} err
 * @returns {string}
 */
function twilioUserFacingError(err) {
  const code = err && typeof err === "object" && "code" in err ? Number(err.code) : NaN;
  const msg = err && typeof err === "object" && "message" in err ? String(err.message || "") : String(err || "");

  if (
    code === 21608 ||
    /trial accounts cannot send to unverified numbers/i.test(msg) ||
    (/unverified/i.test(msg) && /trial/i.test(msg))
  ) {
    return (
      "SMS is not available to this number from the current Twilio setup (usually a trial account): " +
      "the owner must verify this number under Twilio Console → Phone Numbers → Verified Caller IDs, " +
      "or upgrade the Twilio project so SMS can be sent to any number. Use email to receive the code instead."
    );
  }

  return msg || "Twilio send failed.";
}

/**
 * @param {{ to: string, body: string }} opts
 * @returns {Promise<{ skipped?: boolean, sid?: string, error?: string }>}
 */
async function sendSms(opts) {
  if (!smsConfigured()) {
    console.warn("[sms] Twilio not configured; skipping SMS");
    return { skipped: true };
  }

  const to = normalizeTo(opts.to);
  const body = String(opts.body || "").trim();

  if (!to || !E164.test(to)) {
    return { skipped: true, error: "Invalid destination phone number (use E.164, e.g. +15551234567)." };
  }
  if (!body) {
    return { skipped: true, error: "SMS body is empty." };
  }

  try {
    const client = getTwilioClient();
    if (!client) {
      return { skipped: true, error: "Twilio client could not be created." };
    }

    const payload = {
      to,
      body,
    };

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      payload.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
      payload.from =
        normalizeTo(
          process.env.TWILIO_FROM_NUMBER ||
            process.env.TWILIO_PHONE_NUMBER ||
            process.env.TWILIO_FROM ||
            "",
        ) || undefined;
    }

    const msg = await client.messages.create(payload);
    console.info("[sms] sent:", msg.sid, "→", to);
    return { sid: msg.sid };
  } catch (err) {
    console.error("[sms] Twilio error:", err && err.code, err.message || err);
    return { error: twilioUserFacingError(err) };
  }
}

module.exports = {
  smsConfigured,
  sendSms,
  normalizeTo,
};
