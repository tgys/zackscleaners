"use strict";

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const { getInfoEmailAddress, parseFromAddress } = require("./mailAddresses");
const { EMAIL_RE } = require("./inputValidators");

const SYNC_FETCH_MAX = 120;
const MAILDIR_SCAN_MAX = 200;

/** TLS SNI / certificate name when IMAP_HOST is an IP (e.g. 127.0.0.1). */
function imapTlsServername() {
  const explicit = String(process.env.IMAP_TLS_SERVERNAME || "").trim();
  if (explicit) return explicit;
  const user = String(process.env.IMAP_USER || "").trim();
  const at = user.lastIndexOf("@");
  if (at !== -1) return user.slice(at + 1).toLowerCase();
  return "";
}

/**
 * @param {Record<string, unknown> | null | undefined} envelope
 * @returns {{ fromEmail: string; fromName: string }}
 */
function extractFromFields(envelope) {
  if (!envelope) return { fromEmail: "", fromName: "" };
  const lists = [envelope.from, envelope.sender, envelope.replyTo].filter(Boolean);
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      let addr = String(entry.address || "")
        .trim()
        .toLowerCase();
      if (!addr || !EMAIL_RE.test(addr) || addr.length > 254) {
        const rawName = String(entry.name || "").trim();
        if (rawName) addr = parseFromAddress(rawName);
      }
      addr = String(addr || "")
        .trim()
        .toLowerCase();
      if (addr && EMAIL_RE.test(addr) && addr.length <= 254) {
        return {
          fromEmail: addr,
          fromName: String(entry.name || "").trim(),
        };
      }
    }
  }
  return { fromEmail: "", fromName: "" };
}

function crudeBodyFromRaw(buf) {
  if (!buf || !buf.length) return "";
  const s = buf.toString("utf8");
  const lower = s.toLowerCase();
  const idx = lower.indexOf("content-type: text/plain");
  if (idx !== -1) {
    const slice = s.slice(idx);
    const hdrEnd = slice.search(/\r?\n\r?\n/);
    if (hdrEnd !== -1) {
      let body = slice.slice(hdrEnd).replace(/^\r?\n/, "");
      const boundaryRe = /boundary="?([^";\r\n]+)"?/i;
      const bm = lower.match(boundaryRe);
      if (bm && body.includes("--" + bm[1])) {
        const parts = body.split("--" + bm[1]);
        const plainPart =
          parts.find((p) => /content-type:\s*text\/plain/i.test(p)) || parts[0] || body;
        const subHdr = plainPart.search(/\r?\n\r?\n/);
        body = subHdr === -1 ? plainPart : plainPart.slice(subHdr).replace(/^\r?\n/, "");
      }
      return body.replace(/\r\n/g, "\n").trim().slice(0, 100000);
    }
  }
  const dbl = s.search(/\r?\n\r?\n/);
  const body = dbl === -1 ? s : s.slice(dbl + (s.charAt(dbl + 1) === "\n" ? 2 : 4));
  return body.replace(/\r\n/g, "\n").trim().slice(0, 100000);
}

function normalizeMessageId(raw, host, uid) {
  let s = raw && String(raw).replace(/[<>]/g, "").trim();
  if (s) return s.slice(0, 998);
  return `imap:${host}:${uid}`;
}

function parseMaildirHeaderBlock(raw) {
  const sepIdx = raw.search(/\r?\n\r?\n/);
  const headerBlock = sepIdx === -1 ? raw : raw.slice(0, sepIdx);
  const bodyPart = sepIdx === -1 ? "" : raw.slice(sepIdx).replace(/^\r?\n/, "");

  const headers = Object.create(null);
  let lastKey = /** @type {string | null} */ (null);
  for (const line of headerBlock.split(/\r?\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lastKey) {
      headers[lastKey] += line;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0) {
      lastKey = line.slice(0, colon).trim().toLowerCase();
      headers[lastKey] = line.slice(colon + 1).trim();
    }
  }
  return { headers, bodyPart };
}

function displayNameFromFromHeader(fromHeader, fromEmail) {
  const s = String(fromHeader || "").trim();
  if (!s) return "";
  if (parseFromAddress(s) === fromEmail) return "";
  const lt = s.lastIndexOf("<");
  if (lt > 0) {
    return s
      .slice(0, lt)
      .replace(/^["']|["']$/g, "")
      .trim();
  }
  return "";
}

function stableMaildirDedupKey(filePath) {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 48);
}

/** @param {import("pg").Pool} pool */
async function countInfoInboundRows(pool) {
  const r = await pool.query(`SELECT COUNT(*)::int AS c FROM info_inbound_messages`);
  return r.rows[0].c;
}

/**
 * With INBOX already selected under an active {@link ImapFlow#getMailboxLock} critical section,
 * upsert recent messages (same window as full sync).
 * @param {import("pg").Pool} pool
 * @param {import("imapflow").ImapFlow} client
 * @param {string} imapHost
 * @returns {Promise<{ inserted: number }>}
 */
async function syncInfoInboxImapWithConnectedClient(pool, client, imapHost) {
  let inserted = 0;
  const exists = client.mailbox.exists || 0;
  if (exists === 0) return { inserted: 0 };
  const fromSeq = Math.max(1, exists - SYNC_FETCH_MAX + 1);
  const range = `${fromSeq}:*`;
  const infoAddr = getInfoEmailAddress();

  for await (const msg of client.fetch(range, {
    uid: true,
    envelope: true,
    internalDate: true,
    source: true,
  })) {
    const uid = msg.uid;
    const mid = normalizeMessageId(msg.envelope && msg.envelope.messageId, imapHost, uid);
    const { fromEmail, fromName } = extractFromFields(msg.envelope);
    const subject = String((msg.envelope && msg.envelope.subject) || "").trim();
    const receivedAt = msg.internalDate instanceof Date ? msg.internalDate : new Date();
    const bodyText = crudeBodyFromRaw(msg.source);
    if (!fromEmail || !EMAIL_RE.test(fromEmail) || fromEmail.length > 254) {
      continue;
    }
    if (fromEmail === infoAddr) {
      continue;
    }

    try {
      const ins = await pool.query(
        `INSERT INTO info_inbound_messages (
           imap_uid, imap_message_id, from_email, from_name, subject, body_text, received_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (imap_message_id) DO NOTHING`,
        [uid, mid, fromEmail, fromName, subject, bodyText || "(no body)", receivedAt],
      );
      if (ins.rowCount > 0) inserted += ins.rowCount;
    } catch (err) {
      const e = /** @type {Error} */ (err);
      console.error("[imap] insert failed:", mid, e.message);
    }
  }

  return { inserted };
}

/**
 * Import from Dovecot maildir (LMTP delivery) — no IMAP listener required.
 * @param {import("pg").Pool} pool
 * @param {string} maildirRoot e.g. /var/vmail/example.com/info/mail
 */
async function syncInfoMaildir(pool, maildirRoot) {
  const infoAddr = getInfoEmailAddress();
  const newDir = path.join(maildirRoot, "new");
  const curDir = path.join(maildirRoot, "cur");

  /** @type {string[]} */
  const paths = [];
  for (const dir of [newDir, curDir]) {
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch (err) {
      const e = /** @type {NodeJS.ErrnoException} */ (err);
      if (e.code === "ENOENT") continue;
      throw err;
    }
    for (const n of names) {
      paths.push(path.join(dir, n));
    }
  }

  const withStat = await Promise.all(
    paths.map(async (p) => {
      try {
        const st = await fsp.stat(p);
        return { p, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  const sorted = withStat
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAILDIR_SCAN_MAX);

  let inserted = 0;
  for (const { p, mtimeMs } of sorted) {
    let raw;
    try {
      raw = await fsp.readFile(p, "utf8");
    } catch {
      continue;
    }

    const { headers, bodyPart } = parseMaildirHeaderBlock(raw);
    const midRaw = headers["message-id"];
    const mid = midRaw
      ? normalizeMessageId(midRaw, "maildir", 0)
      : `maildir:${stableMaildirDedupKey(p)}`;

    const fromHeader = headers.from || headers["resent-from"] || "";
    const fromEmail = parseFromAddress(fromHeader).toLowerCase();
    const fromName = displayNameFromFromHeader(fromHeader, fromEmail);
    const subject = String(headers.subject || "").trim();
    let receivedAt = new Date(mtimeMs);
    if (headers.date) {
      const tryDate = new Date(headers.date);
      if (!Number.isNaN(tryDate.getTime())) receivedAt = tryDate;
    }

    if (!fromEmail || !EMAIL_RE.test(fromEmail) || fromEmail.length > 254) continue;
    if (fromEmail === infoAddr) continue;

    const bodyText = crudeBodyFromRaw(Buffer.from(bodyPart, "utf8")) || "(no body)";

    try {
      const ins = await pool.query(
        `INSERT INTO info_inbound_messages (
           imap_uid, imap_message_id, from_email, from_name, subject, body_text, received_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (imap_message_id) DO NOTHING`,
        [null, mid, fromEmail, fromName, subject, bodyText, receivedAt],
      );
      if (ins.rowCount > 0) inserted += ins.rowCount;
    } catch (err) {
      const e = /** @type {Error} */ (err);
      console.error("[maildir] insert failed:", mid, e.message);
    }
  }

  return { skipped: false, inserted, source: "maildir" };
}

/**
 * Pull recent messages from the info@ mailbox into info_inbound_messages.
 * Prefers INFO_MAILDIR (maildir) when set — works without IMAP. Falls back to IMAP.
 * @param {import("pg").Pool} pool
 */
async function syncInfoInbox(pool) {
  const before = await countInfoInboundRows(pool);
  const maildir = String(process.env.INFO_MAILDIR || "").trim();
  if (maildir) {
    try {
      const r = await syncInfoMaildir(pool, maildir);
      const after = await countInfoInboundRows(pool);
      return { ...r, newInfoRows: after > before };
    } catch (err) {
      const e = /** @type {Error} */ (err);
      console.error("[maildir] sync failed:", e.message);
    }
  }

  const host = String(process.env.IMAP_HOST || "").trim();
  const user = String(process.env.IMAP_USER || "").trim();
  if (!host || !user) {
    return {
      skipped: true,
      reason: maildir ? "maildir failed and IMAP not configured" : "IMAP not configured",
    };
  }

  let ImapFlow;
  try {
    ({ ImapFlow } = require("imapflow"));
  } catch (e) {
    console.warn("[imap] imapflow not available:", e.message);
    return { skipped: true, reason: "imapflow missing" };
  }

  const port = Number(process.env.IMAP_PORT || 993);
  const secure = process.env.IMAP_TLS !== "0" && process.env.IMAP_TLS !== "false";
  const pass = process.env.IMAP_PASS || "";
  const mailbox = String(process.env.IMAP_MAILBOX || "INBOX").trim() || "INBOX";

  const servername = imapTlsServername();
  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
    ...(servername ? { servername } : {}),
  });

  await client.connect();
  const lock = await client.getMailboxLock(mailbox);
  let inserted = 0;
  try {
    const { inserted: insCount } = await syncInfoInboxImapWithConnectedClient(pool, client, host);
    inserted = insCount;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }

  const after = await countInfoInboundRows(pool);
  return { skipped: false, inserted, source: "imap", newInfoRows: after > before };
}

module.exports = {
  syncInfoInbox,
  syncInfoMaildir,
  countInfoInboundRows,
  syncInfoInboxImapWithConnectedClient,
  crudeBodyFromRaw,
};
