"use strict";

const fs = require("fs");
const path = require("path");

const {
  syncInfoMaildir,
  countInfoInboundRows,
  syncInfoInboxImapWithConnectedClient,
} = require("./infoInboxSync");

function imapTlsServername() {
  const explicit = String(process.env.IMAP_TLS_SERVERNAME || "").trim();
  if (explicit) return explicit;
  const user = String(process.env.IMAP_USER || "").trim();
  const at = user.lastIndexOf("@");
  if (at !== -1) return user.slice(at + 1).toLowerCase();
  return "";
}

function debounceAsync(fn, ms) {
  let t = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn().catch((err) => console.error("[info-inbox realtime debounce]", err.message));
    }, ms);
  };
}

/**
 * @returns {boolean} true if at least one fs.watch was registered
 * @param {{ pool: import("pg").Pool; notifyInboxChanged: () => void }} ctx
 */
function tryStartMaildirWatcher(maildirRoot, ctx) {
  const { pool, notifyInboxChanged } = ctx;
  const run = debounceAsync(async () => {
    try {
      const before = await countInfoInboundRows(pool);
      const r = await syncInfoMaildir(pool, maildirRoot);
      const after = await countInfoInboundRows(pool);
      const fresh = after > before;
      if (fresh) notifyInboxChanged();
    } catch (err) {
      const e = /** @type {Error} */ (err);
      console.error("[info-inbox maildir watch]", e.message);
    }
  }, 200);

  let anyWatch = false;
  for (const sub of ["new", "cur", "tmp"]) {
    const dir = path.join(maildirRoot, sub);
    try {
      fs.watch(dir, { persistent: true }, run);
      anyWatch = true;
    } catch (err) {
      const e = /** @type {NodeJS.ErrnoException} */ (err);
      if (e.code === "ENOENT") continue;
      console.error("[info-inbox maildir watch] fs.watch:", dir, e.message);
    }
  }
  return anyWatch;
}

/** @param {{ pool: import("pg").Pool; notifyInboxChanged: () => void }} ctx */
async function imapIdleLoopForever(ctx) {
  const { pool, notifyInboxChanged } = ctx;
  const host = String(process.env.IMAP_HOST || "").trim();
  const user = String(process.env.IMAP_USER || "").trim();
  if (!host || !user) return;

  let ImapFlow;
  try {
    ({ ImapFlow } = require("imapflow"));
  } catch (e) {
    console.warn("[info-inbox idle] imapflow not available:", e.message);
    return;
  }

  const port = Number(process.env.IMAP_PORT || 993);
  const secure = process.env.IMAP_TLS !== "0" && process.env.IMAP_TLS !== "false";
  const pass = process.env.IMAP_PASS || "";
  const mailbox = String(process.env.IMAP_MAILBOX || "INBOX").trim() || "INBOX";
  const servername = imapTlsServername();

  const IDLE_RESTART_MS = (() => {
    const n = Number(process.env.IMAP_IDLE_RESTART_MS);
    if (Number.isFinite(n) && n >= 60_000) return n;
    return 20 * 60 * 1000;
  })();

  while (true) {
    let client;
    try {
      client = new ImapFlow({
        host,
        port,
        secure,
        auth: { user, pass },
        logger: false,
        maxIdleTime: IDLE_RESTART_MS,
        ...(servername ? { servername } : {}),
      });
      await client.connect();

      let syncing = false;
      client.on("exists", async (data) => {
        if (!data || data.count <= data.prevCount) return;
        if (syncing) return;
        syncing = true;
        try {
          const lock = await client.getMailboxLock(mailbox);
          try {
            const before = await countInfoInboundRows(pool);
            await syncInfoInboxImapWithConnectedClient(pool, client, host);
            const after = await countInfoInboundRows(pool);
            if (after > before) notifyInboxChanged();
          } finally {
            lock.release();
          }
        } catch (err) {
          const e = /** @type {Error} */ (err);
          console.error("[info-inbox idle] sync on EXISTS:", e.message);
        } finally {
          syncing = false;
        }
      });

      const boot = await client.getMailboxLock(mailbox);
      boot.release();

      while (client.usable) {
        await client.idle();
      }
    } catch (err) {
      const e = /** @type {Error} */ (err);
      console.error("[info-inbox idle] session:", e.message);
    } finally {
      if (client) await client.logout().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

function startImapIdleIfConfigured(ctx, logLabel) {
  const host = String(process.env.IMAP_HOST || "").trim();
  const user = String(process.env.IMAP_USER || "").trim();
  const mailbox = String(process.env.IMAP_MAILBOX || "INBOX").trim() || "INBOX";
  if (!host || !user) {
    console.warn("[info-inbox realtime] IMAP not configured;", logLabel);
    return;
  }
  void imapIdleLoopForever(ctx).catch((err) => {
    console.error("[info-inbox idle] fatal:", (/** @type {Error} */ (err)).message);
  });
  console.log("[info-inbox realtime] IMAP IDLE push watcher:", host, mailbox, logLabel);
}

/**
 * Push path: Maildir fs.watch or IMAP IDLE → sync → {@link notifyInboxChanged} → WebSocket to admins.
 * Set INFO_INBOX_PUSH=0 to disable (polling only).
 *
 * If INFO_MAILDIR is set but the process cannot read/watch it (e.g. missing `vmail` supplementary group),
 * falls back to IMAP IDLE so WebSocket updates still work.
 * @param {{ pool: import("pg").Pool; notifyInboxChanged: () => void }} ctx
 */
function startInfoInboxRealtimeWatcher(ctx) {
  const raw = process.env.INFO_INBOX_PUSH;
  if (raw === "0" || raw === "false") return;

  const maildir = String(process.env.INFO_MAILDIR || "").trim();
  if (maildir) {
    if (tryStartMaildirWatcher(maildir, ctx)) {
      console.log("[info-inbox realtime] maildir push watcher:", maildir);
      return;
    }
    console.warn(
      "[info-inbox realtime] cannot watch Maildir (check permissions / vmail group). Falling back to IMAP IDLE.",
    );
    startImapIdleIfConfigured(ctx, "(maildir fallback)");
    return;
  }

  startImapIdleIfConfigured(ctx, "");
}

module.exports = { startInfoInboxRealtimeWatcher };
