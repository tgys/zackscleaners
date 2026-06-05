"use strict";

const { pool } = require("./db");
const { getInfoEmailAddress } = require("./mailAddresses");
const { EMAIL_RE } = require("./inputValidators");

/**
 * Values used in admin inbox reply emails (HTML + plain text signature block).
 * signatureEmail — stored raw for the Settings form.
 * infoEmail — address shown in replies: stored signature email if valid, else MAIL_INFO_ADDRESS.
 * @returns {Promise<{ displayName: string; phone: string; address: string; signatureEmail: string; infoEmail: string }>}
 */
async function getBusinessSignatureSettings() {
  const fallbackInfo = getInfoEmailAddress();
  const q = await pool.query(
    `SELECT signature_display_name, signature_phone, signature_address, signature_email
     FROM business_settings
     WHERE id = 1
     LIMIT 1`,
  );
  if (q.rows.length === 0) {
    return { displayName: "", phone: "", address: "", signatureEmail: "", infoEmail: fallbackInfo };
  }
  const r = q.rows[0];
  const storedTrim = String(r.signature_email || "").trim();
  const storedLower = storedTrim.toLowerCase();
  const infoEmail =
    storedTrim && EMAIL_RE.test(storedLower) && storedLower.length <= 254 ? storedLower : fallbackInfo;
  return {
    displayName: String(r.signature_display_name || ""),
    phone: String(r.signature_phone || ""),
    address: String(r.signature_address || ""),
    signatureEmail: storedTrim,
    infoEmail,
  };
}

/**
 * @param {{ displayName: string; phone: string; address: string; signatureEmail: string }} row
 */
async function updateBusinessSignatureSettings(row) {
  await pool.query(
    `INSERT INTO business_settings (id, signature_display_name, signature_phone, signature_address, signature_email, updated_at)
     VALUES (1, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       signature_display_name = EXCLUDED.signature_display_name,
       signature_phone = EXCLUDED.signature_phone,
       signature_address = EXCLUDED.signature_address,
       signature_email = EXCLUDED.signature_email,
       updated_at = now()`,
    [row.displayName, row.phone, row.address, row.signatureEmail],
  );
}

module.exports = {
  getBusinessSignatureSettings,
  updateBusinessSignatureSettings,
};
