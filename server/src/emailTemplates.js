"use strict";

/** Matches auth.css / site: dark teal page, glass card, cyan accent (#66ddff). Inline CSS only for email clients. */
const C = {
  pageBg: "#061018",
  cardBg: "#0a1c2c",
  cardBorder: "#4dadc9",
  accent: "#66ddff",
  text: "#e8eef5",
  muted: "#b8c4d4",
  subtleBorder: "rgba(102, 221, 255, 0.22)",
};

/** Webfont stack for admin-sent replies (IBM Plex Mono via Google Fonts link in shell). */
const IBM_PLEX_MONO_STACK =
  "'IBM Plex Mono', ui-monospace, Menlo, Consolas, 'Courier New', monospace";
/** Footer disclaimer — Roboto Condensed exists as its own family on Google Fonts (requested vs Roboto Thin). */
const ROBOTO_CONDENSED_STACK = "'Roboto Condensed', Roboto, Arial, Helvetica, sans-serif";
/** IBM Plex Mono + Roboto Condensed in one request for admin inbox replies. */
const ADMIN_REPLY_GOOGLE_CSS =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Roboto+Condensed:wght@400;700&display=swap";

/** Match admin Messages reply typography for login/signup transactional mail. */
const TRANSACTIONAL_SHELL_TYPOGRAPHY = {
  fontFamily: IBM_PLEX_MONO_STACK,
  googleFontHref: ADMIN_REPLY_GOOGLE_CSS,
  innerTdFontSize: "9pt",
  footerTdFontSize: "6pt",
};

const transactionalFooterHtml =
  `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${C.subtleBorder};` +
  `font-family:${ROBOTO_CONDENSED_STACK};font-size:6pt;font-weight:400;line-height:1.3;color:${C.muted};">` +
  `This message was sent because of activity on your Zack&apos;s Maids account. If you didn&apos;t expect it, you can ignore this email.` +
  `</p>`;

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Banner row matching admin inbox replies: top border + logo top-right beside an empty stack cell.
 * `bannerLogoSrc` is `cid:…` with attached PNG raster of the SVG, or an absolute URL to `/email-banner-logo-static.svg`.
 */
function transactionalBannerLogoRow(bannerLogoSrc) {
  const raw = bannerLogoSrc != null ? String(bannerLogoSrc).trim() : "";
  if (!raw) return "";
  const escaped = escapeHtml(raw);
  const leftEmptyStyle = `margin:0;font-family:${IBM_PLEX_MONO_STACK};font-size:9pt;line-height:1.35;color:${C.muted};`;
  const logoCell = `<td align="right" valign="top" style="padding:0 0 0 12px;width:1%;white-space:nowrap;vertical-align:top;"><img src="${escaped}" alt="" width="132" height="88" style="display:block;border:0;line-height:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" /></td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 0;padding-top:5px;border-top:1px solid ${C.subtleBorder};"><tr><td align="left" valign="top" style="${leftEmptyStyle}">&nbsp;</td>${logoCell}</tr></table>`;
}

/** @param {{ preheader?: string, innerHtml: string, footerHtml?: string, compactBrandHeader?: boolean, expandToViewport?: boolean, typography?: { fontFamily: string, googleFontHref: string, innerTdFontSize: string, footerTdFontSize: string, innerTdPadding?: string, footerTdPadding?: string, shellTablePadding?: string, brandHeaderTdPadding?: string } }} opts */
function shell({
  preheader,
  innerHtml,
  footerHtml,
  compactBrandHeader,
  typography,
  expandToViewport = false,
}) {
  const pre = escapeHtml(preheader || "");
  const foot =
    footerHtml ||
    `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${C.subtleBorder};">This message was sent because of activity on your Zack&apos;s Maids account. If you didn&apos;t expect it, you can ignore this email.</p>`;
  const brandPad =
    typography && typography.brandHeaderTdPadding
      ? typography.brandHeaderTdPadding
      : "22px 26px 18px";

  const headerRow = compactBrandHeader
    ? `<tr><td aria-hidden="true" style="padding:10px 22px 6px;border-bottom:1px solid ${C.subtleBorder};background:linear-gradient(180deg,rgba(102,221,255,0.08) 0%,transparent 100%);">&nbsp;</td></tr>`
    : `<tr><td align="center" style="padding:${brandPad};text-align:center;border-bottom:1px solid ${C.subtleBorder};background:linear-gradient(180deg,rgba(102,221,255,0.08) 0%,transparent 100%);">
<p style="margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${C.accent};font-weight:600;">Zack&apos;s Maids</p>
</td></tr>`;

  const fontHead =
    typography && typography.googleFontHref
      ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${typography.googleFontHref}" rel="stylesheet" />
`
      : "";

  const innerTdPad =
    typography && typography.innerTdPadding ? typography.innerTdPadding : "26px 26px 28px";

  const shellPad =
    typography && typography.shellTablePadding != null
      ? typography.shellTablePadding
      : "28px 14px";

  let innerTdStyle = typography
    ? `padding:${innerTdPad};text-align:left;font-family:${typography.fontFamily};font-size:${typography.innerTdFontSize};line-height:1.55;color:${C.text};`
    : `padding:26px 26px 28px;text-align:left;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.55;color:${C.text};`;

  const footerTdPad =
    typography && typography.footerTdPadding ? typography.footerTdPadding : "0 26px 22px";

  let footerTdStyle = typography
    ? `padding:${footerTdPad};text-align:left;font-family:${typography.fontFamily};font-size:${typography.footerTdFontSize};line-height:1.35;color:${C.muted};`
    : `padding:0 26px 22px;text-align:left;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.45;color:${C.muted};`;

  const htmlAttrs = expandToViewport
    ? ` lang="en" style="margin:0;padding:0;width:100%;min-height:100%;"`
    : ` lang="en"`;

  const bodyStyle = expandToViewport
    ? `margin:0;padding:2%;box-sizing:border-box;width:100%;min-height:100%;background:${C.pageBg};-webkit-text-size-adjust:100%;`
    : `margin:0;padding:0;background:${C.pageBg};-webkit-text-size-adjust:100%;`;

  const outerTablePadding = expandToViewport ? "0" : shellPad;

  const outerTableStyle = expandToViewport
    ? `background:${C.pageBg};padding:${outerTablePadding};width:100%;min-height:100%;border-collapse:collapse;`
    : `background:${C.pageBg};padding:${outerTablePadding};`;

  const cardAttrs = expandToViewport ? ` width="100%"` : "";

  const cardStyleInner = expandToViewport
    ? `width:100%;max-width:100%;background:${C.cardBg};border:1px solid ${C.subtleBorder};border-radius:10px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.45);border-collapse:collapse;min-height:100%;`
    : `max-width:520px;background:${C.cardBg};border:1px solid ${C.subtleBorder};border-radius:10px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.45);`;

  if (expandToViewport) {
    innerTdStyle +=
      ";vertical-align:top;width:100%;box-sizing:border-box;min-height:85vh;height:auto;";
    footerTdStyle += ";vertical-align:bottom;width:100%;box-sizing:border-box";
  }

  const wrapAlign = expandToViewport ? "top" : "middle";

  return `<!DOCTYPE html>
<html${htmlAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${fontHead}<title></title>
</head>
<body style="${bodyStyle}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${pre}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${outerTableStyle}">
<tr><td align="center" valign="${wrapAlign}" style="vertical-align:${wrapAlign};width:100%;${expandToViewport ? "min-height:100%;height:100%;" : ""}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"${cardAttrs} style="${cardStyleInner}">
${headerRow}
<tr><td align="left" style="${innerTdStyle}">
${innerHtml}
</td></tr>
<tr><td align="left" style="${footerTdStyle}">
${foot}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buttonRow(href, label) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px;">
<tr><td align="left">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeHref}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="12%" strokecolor="${C.accent}" fillcolor="rgba(102,221,255,0.12)">
<w:anchorlock/><center style="color:${C.text};font-family:${IBM_PLEX_MONO_STACK};font-size:14px;font-weight:600;">${safeLabel}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${safeHref}" style="display:inline-block;padding:12px 22px;border-radius:8px;border:1px solid ${C.accent};background:rgba(102,221,255,0.12);color:${C.text};font-weight:600;text-decoration:none;font-size:14px;font-family:${IBM_PLEX_MONO_STACK};">${safeLabel}</a>
<!--<![endif]-->
</td></tr>
</table>`;
}

/** Keep “expires in …” copy aligned with `OTP_TTL_MS` in `authRoutes.js`. */
function registrationOtpEmail({ displayName, code, bannerLogoSrc }) {
  const name = displayName && String(displayName).trim();
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const safeCode = escapeHtml(code);
  const inner = `
<p style="margin:0 0 14px;color:${C.text};">${greeting}</p>
<p style="margin:0 0 14px;color:${C.muted};">Use this one-time code to finish verifying your <strong style="color:${C.text};">Zack&apos;s Maids</strong> account:</p>
<p style="margin:20px 0;font-size:28px;letter-spacing:0.22em;font-weight:700;color:${C.accent};font-family:${IBM_PLEX_MONO_STACK};">${safeCode}</p>
<p style="margin:0 0 14px;font-size:13px;color:${C.muted};">It expires in 2 minutes. If you didn&apos;t create an account, ignore this email.</p>${transactionalBannerLogoRow(bannerLogoSrc)}`;

  const html = shell({
    preheader: `Your verification code is ${code}.`,
    innerHtml: inner,
    typography: TRANSACTIONAL_SHELL_TYPOGRAPHY,
    footerHtml: transactionalFooterHtml,
  });

  const text =
    (name ? `Hi ${name},\n\n` : "Hi,\n\n") +
    `Your Zack's Maids verification code is: ${code}\n\n` +
    "It expires in 2 minutes.\n";

  return { html, text, subject: "Your verification code — Zack's Maids" };
}

function verifyRegistrationEmail({ displayName, verifyUrl }) {
  const name = displayName && String(displayName).trim();
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const urlEscaped = escapeHtml(verifyUrl);
  const inner = `
<p style="margin:0 0 14px;color:${C.text};">${greeting}</p>
<p style="margin:0 0 14px;color:${C.muted};">Thanks for creating an account with <strong style="color:${C.text};">Zack&apos;s Maids</strong>. Please confirm your email so we can finish setting things up.</p>
<p style="margin:0 0 14px;color:${C.muted};">You won&apos;t be able to sign in until this step is complete. This link expires in 48 hours.</p>
${buttonRow(verifyUrl, "Confirm email")}
<p style="margin:18px 0 0;font-size:13px;color:${C.muted};">If the button doesn&apos;t work, copy this link:<br><span style="word-break:break-all;color:${C.accent};">${urlEscaped}</span></p>`;

  const html = shell({
    preheader: "Confirm your email for Zack's Maids.",
    innerHtml: inner,
    typography: TRANSACTIONAL_SHELL_TYPOGRAPHY,
    footerHtml: transactionalFooterHtml,
  });

  const text =
    (name ? `Hi ${name},\n\n` : "Hi,\n\n") +
    "Confirm your Zack's Maids account by opening this link (expires in 48 hours):\n\n" +
    `${verifyUrl}\n`;

  return { html, text, subject: "Confirm your email — Zack's Maids" };
}

function passwordResetEmail({ resetUrl, bannerLogoSrc }) {
  const reset = escapeHtml(resetUrl);
  const inner = `
<p style="margin:0 0 14px;color:${C.text};">We received a request to reset the password for your Zack&apos;s Maids account.</p>
<p style="margin:0 0 14px;color:${C.muted};">Use the button below to choose a new password. This link expires in one hour.</p>
${buttonRow(resetUrl, "Choose a new password")}
<p style="margin:18px 0 0;font-size:13px;color:${C.muted};">If the button doesn&apos;t work, copy this link:<br><span style="word-break:break-all;color:${C.accent};">${reset}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:${C.muted};">If you didn&apos;t ask for a reset, you can safely ignore this email.</p>${transactionalBannerLogoRow(bannerLogoSrc)}`;

  const html = shell({
    preheader: "Reset your Zack's Maids password.",
    innerHtml: inner,
    typography: TRANSACTIONAL_SHELL_TYPOGRAPHY,
    footerHtml: transactionalFooterHtml,
  });

  const text =
    "Reset your Zack's Maids password using this link (expires in one hour):\n\n" +
    `${resetUrl}\n\n` +
    "If you didn't request this, ignore this email.\n";

  return { html, text, subject: "Reset your Zack's Maids password" };
}

/** Admin inbox reply — plain body; subject set by caller. Optional signature from business_settings.
 * `signatureLogoSrc` should be `cid:zacks-banner-logo` when a PNG attachment is included, or an absolute https URL as fallback.
 */
function adminInboxReplyEmail({ recipientName, bodyText, signature, signatureLogoSrc }) {
  const name = recipientName && String(recipientName).trim();
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const bodyEsc = escapeHtml(bodyText).replace(/\n/g, "<br />");

  const sig = signature && typeof signature === "object" ? signature : {};
  const sigName = sig.displayName != null ? String(sig.displayName).trim() : "";
  const sigPhone = sig.phone != null ? String(sig.phone).trim() : "";
  const sigAddr = sig.address != null ? String(sig.address).trim() : "";
  const sigInfo =
    sig.infoEmail != null && String(sig.infoEmail).trim()
      ? String(sig.infoEmail).trim()
      : "";
  const logoSrcRaw = signatureLogoSrc != null ? String(signatureLogoSrc).trim() : "";
  const logoSrcEsc = logoSrcRaw ? escapeHtml(logoSrcRaw) : "";
  const showLogo = Boolean(logoSrcEsc);
  const hasTextSig = Boolean(sigName || sigPhone || sigAddr || sigInfo);

  const sigStackStyle = `margin:0;font-family:${IBM_PLEX_MONO_STACK};font-size:9pt;line-height:1.35;color:${C.muted};`;

  let sigHtml = "";
  if (hasTextSig || showLogo) {
    const parts = [];
    if (sigName) {
      parts.push(
        `<p style="margin:0 0 3px;color:${C.text};font-family:${IBM_PLEX_MONO_STACK};font-size:9pt;">${escapeHtml(sigName)}</p>`,
      );
    }
    if (sigPhone) {
      parts.push(
        `<p style="margin:0 0 3px;color:${C.text};font-family:${IBM_PLEX_MONO_STACK};font-size:9pt;">${escapeHtml(sigPhone)}</p>`,
      );
    }
    if (sigAddr) {
      const addrEsc = escapeHtml(sigAddr).replace(/\n/g, "<br />");
      parts.push(
        `<p style="margin:0 0 3px;color:${C.muted};font-family:${IBM_PLEX_MONO_STACK};font-size:9pt;">${addrEsc}</p>`,
      );
    }
    if (sigInfo) {
      parts.push(
        `<p style="margin:0;font-family:${IBM_PLEX_MONO_STACK};font-size:9pt;"><span style="color:${C.muted};">Email:</span> ${escapeHtml(sigInfo)}</p>`,
      );
    }
    const stackInner = parts.join("");
    const logoCell = showLogo
      ? `<td align="right" valign="top" style="padding:0 0 0 12px;width:1%;white-space:nowrap;vertical-align:top;"><img src="${logoSrcEsc}" alt="" width="132" height="88" style="display:block;border:0;line-height:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" /></td>`
      : "";
    if (showLogo) {
      sigHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 0;padding-top:5px;border-top:1px solid ${C.subtleBorder};"><tr><td align="left" valign="top" style="${sigStackStyle}">${stackInner || "&nbsp;"}</td>${logoCell}</tr></table>`;
    } else {
      sigHtml = `<div style="margin:6px 0 0;padding-top:5px;border-top:1px solid ${C.subtleBorder};${sigStackStyle}">${stackInner}</div>`;
    }
  }

  const inner = `
<p style="margin:0 0 8px;color:${C.text};font-family:${IBM_PLEX_MONO_STACK};font-size:10pt;line-height:1.45;">${greeting}</p>
<div style="margin:0;width:100%;display:block;box-sizing:border-box;color:${C.text};font-family:${IBM_PLEX_MONO_STACK};font-size:9pt;line-height:1.55;">${bodyEsc}</div>${sigHtml}`;
  const footerHtml = `<p style="margin:0;padding-top:3px;border-top:1px solid ${C.subtleBorder};font-family:${ROBOTO_CONDENSED_STACK};font-size:6pt;font-weight:400;line-height:1.3;color:${C.muted};">This message is a direct reply from Zack&apos;s Maids staff regarding your contact message or job application.</p>`;
  const html = shell({
    preheader: "Message from Zack's Maids",
    innerHtml: inner,
    footerHtml,
    compactBrandHeader: false,
    expandToViewport: true,
    typography: {
      fontFamily: IBM_PLEX_MONO_STACK,
      googleFontHref: ADMIN_REPLY_GOOGLE_CSS,
      innerTdFontSize: "9pt",
      footerTdFontSize: "6pt",
      innerTdPadding: "10px 22px 8px",
      footerTdPadding: "2px 22px 8px",
      brandHeaderTdPadding: "12px 22px 8px",
    },
  });

  let textSig = "";
  if (hasTextSig || showLogo) {
    textSig = "\n\n—\n";
    if (sigName) textSig += `${sigName}\n`;
    if (sigPhone) textSig += `${sigPhone}\n`;
    if (sigAddr) textSig += `${sigAddr}\n`;
    if (sigInfo) textSig += `Email: ${sigInfo}\n`;
  } else {
    textSig = "\n\n— Zack's Maids\n";
  }

  const text =
    (name ? `Hi ${name},\n\n` : "Hi,\n\n") +
    bodyText +
    textSig;

  return { html, text };
}

module.exports = {
  registrationOtpEmail,
  verifyRegistrationEmail,
  passwordResetEmail,
  adminInboxReplyEmail,
  escapeHtml,
};
