"use strict";

const { getCountries, getCountryCallingCode, parsePhoneNumberFromString } = require("libphonenumber-js");

const ALLOWED_PREFIXES = new Set();
for (const c of getCountries()) {
  ALLOWED_PREFIXES.add(`+${getCountryCallingCode(c)}`);
}

/** Shown when the number does not match libphonenumber validation for the selected calling code. */
const PHONE_GENERIC_HINT =
  "Use digits only after the country code (no spaces). Drop any leading 0 before the area code if your number still fails.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Disallow ASCII control chars in free-text name (Unicode letters OK). */
const NAME_CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function trimStr(v, max) {
  const s = v == null ? "" : String(v).trim();
  if (max != null && s.length > max) return null;
  return s;
}

function digitsOnly(s) {
  return String(s).replace(/\D/g, "");
}

const MAX_LEADING_ZERO_STRIPS = 4;

/**
 * @param {string} prefix e.g. "+44"
 * @param {unknown} nationalRaw
 * @returns {{ ok: true; mobile: string } | { ok: false; reason: string; hint?: string }}
 */
function validatePhone(prefix, nationalRaw) {
  if (prefix == null || typeof prefix !== "string" || !ALLOWED_PREFIXES.has(prefix.trim())) {
    return { ok: false, reason: "unsupported_prefix", hint: "Choose a country code from the list." };
  }
  const pfx = prefix.trim();
  const wantCc = pfx.slice(1);

  let d = digitsOnly(nationalRaw);
  if (!d) {
    return { ok: false, reason: "format", hint: PHONE_GENERIC_HINT };
  }

  for (let strip = 0; strip <= MAX_LEADING_ZERO_STRIPS; strip++) {
    const parsed = parsePhoneNumberFromString(pfx + d);
    if (
      parsed &&
      parsed.isValid() &&
      String(parsed.countryCallingCode) === wantCc
    ) {
      return { ok: true, mobile: parsed.number };
    }
    if (!d.startsWith("0")) break;
    d = d.slice(1);
  }

  return { ok: false, reason: "format", hint: PHONE_GENERIC_HINT };
}

/**
 * @param {number} maxPerWindow
 * @param {(req: import('express').Request) => string} [keyFn]
 */
function createHourlyIpLimiter(maxPerWindow, keyFn) {
  const RATE_WINDOW_MS = 60 * 60 * 1000;
  const rateBuckets = new Map();
  return function hourlyIpRateLimit(req, res, next) {
    const ip = keyFn ? keyFn(req) : req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let b = rateBuckets.get(ip);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + RATE_WINDOW_MS };
      rateBuckets.set(ip, b);
    }
    if (b.count >= maxPerWindow) {
      return res.status(429).json({
        error: "Too many submissions from this address. Please try again later.",
      });
    }
    b.count += 1;
    next();
  };
}

module.exports = {
  EMAIL_RE,
  NAME_CTRL_RE,
  ALLOWED_PREFIXES,
  PHONE_GENERIC_HINT,
  trimStr,
  validatePhone,
  createHourlyIpLimiter,
};
