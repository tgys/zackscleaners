"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

/** Must match `src="cid:…"` in HTML (no angle brackets). */
const SIGNATURE_LOGO_CID = "zacks-banner-logo";

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const STATIC_SVG = path.join(PROJECT_ROOT, "email-banner-logo-static.svg");
const STATIC_PNG = path.join(PROJECT_ROOT, "email-banner-logo.png");

/**
 * Raster banner SVG → PNG for inline CID embedding (Outlook / Gmail-friendly).
 * Prefers committed PNG when present; otherwise Sharp + `email-banner-logo-static.svg`.
 * @returns {Promise<Buffer | null>}
 */
async function loadBannerLogoPngBuffer() {
  try {
    if (fs.existsSync(STATIC_PNG)) {
      return await fsp.readFile(STATIC_PNG);
    }
    if (!fs.existsSync(STATIC_SVG)) {
      return null;
    }
    const svgBuf = await fsp.readFile(STATIC_SVG);
    let sharp;
    try {
      sharp = require("sharp");
    } catch {
      return null;
    }
    return await sharp(svgBuf).resize({ width: 264 }).png().toBuffer();
  } catch (err) {
    console.warn("[email-logo] could not build PNG:", /** @type {Error} */ (err).message);
    return null;
  }
}

/**
 * @returns {Promise<{ filename: string; content: Buffer; cid: string; contentDisposition: string; contentType: string } | null>}
 */
async function bannerLogoPngAttachment() {
  const png = await loadBannerLogoPngBuffer();
  if (!png || !png.length) return null;
  return {
    filename: "zacks-banner-logo.png",
    content: png,
    cid: SIGNATURE_LOGO_CID,
    contentDisposition: "inline",
    contentType: "image/png",
  };
}

module.exports = {
  SIGNATURE_LOGO_CID,
  bannerLogoPngAttachment,
};
