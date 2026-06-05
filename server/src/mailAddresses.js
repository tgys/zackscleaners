"use strict";

const DEFAULT_INFO_EMAIL = "info@zacks.cleaners.tesko.io";

/** Extract addr@domain from 'Name <addr@domain>' or return trimmed string. */
function parseFromAddress(fromHeader) {
  const s = String(fromHeader || "").trim();
  const m = s.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  return s.toLowerCase();
}

/** Domain part of the mailbox in MAIL_FROM / From (for EHLO + Message-ID alignment). */
function domainFromFromHeader(fromHeader) {
  const addr = parseFromAddress(fromHeader);
  const at = addr.lastIndexOf("@");
  if (at === -1 || at >= addr.length - 1) return "";
  return addr.slice(at + 1).trim().toLowerCase();
}

function getInfoEmailAddress() {
  return (process.env.MAIL_INFO_ADDRESS || DEFAULT_INFO_EMAIL).trim().toLowerCase();
}

function getNoreplyFromHeader() {
  return (process.env.MAIL_FROM || "").trim() || `Zack's Maids <noreply@${DEFAULT_INFO_EMAIL.split("@")[1] || "localhost"}>`;
}

function getInfoFromHeader() {
  const v = (process.env.MAIL_FROM_INFO || "").trim();
  if (v) return v;
  return `Zack's Maids <${getInfoEmailAddress()}>`;
}

function getNoreplyMailboxTag() {
  return parseFromAddress(getNoreplyFromHeader()) || "noreply";
}

module.exports = {
  DEFAULT_INFO_EMAIL,
  parseFromAddress,
  domainFromFromHeader,
  getInfoEmailAddress,
  getNoreplyFromHeader,
  getInfoFromHeader,
  getNoreplyMailboxTag,
};
