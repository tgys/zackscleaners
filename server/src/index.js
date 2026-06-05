"use strict";

const http = require("http");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
require("dotenv").config({
  path: path.join(__dirname, "..", "..", ".env"),
  override: true,
});

const { pool } = require("./db");
const { router: authRouter, deleteStalePendingRegistrations } = require("./authRoutes");
const { router: adminRouter } = require("./adminRoutes");
const { router: bookingRouter } = require("./bookingRoutes");
const { router: contactRouter } = require("./contactRoutes");
const { router: recruitmentRouter } = require("./recruitmentRoutes");
const {
  attach: attachAdminMessagesRealtime,
  notifyInboxChanged,
} = require("./adminMessagesRealtime");
const { startInfoInboxRealtimeWatcher } = require("./infoInboxRealtime");
const { syncInfoInbox } = require("./infoInboxSync");
const { warnIfStripeCredentialMismatch } = require("./stripeBooking");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "..", "..");
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET === "change_me_to_a_long_random_string") {
  console.warn(
    "WARNING: Set SESSION_SECRET in .env to a unique random value (e.g. openssl rand -hex 32).",
  );
}

warnIfStripeCredentialMismatch();

const app = express();

if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json());
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

const sessionMiddleware = session({
  store: new pgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false,
  }),
  name: "sid",
  secret: SESSION_SECRET || "insecure-dev-only",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/bookings", bookingRouter);
app.use("/api/contact", contactRouter);
app.use("/api/recruitment", recruitmentRouter);

const SERVE_STATIC = process.env.SERVE_STATIC !== "false";
if (SERVE_STATIC) {
  app.use(
    express.static(ROOT, {
      index: false,
      fallthrough: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, max-age=0");
        }
      },
    }),
  );

  app.get("/", (_req, res) => {
    res.redirect(302, "/demo.html");
  });

  app.get(["/about", "/about/"], (_req, res) => {
    res.redirect(302, "/about.html");
  });
} else {
  // Production normally serves *.html from nginx. If a catch-all proxy sends page
  // requests here anyway, still ship About so nav links never hit Express 404.
  const aboutPath = path.join(ROOT, "about.html");
  app.get("/about.html", (_req, res, next) => {
    res.sendFile(
      aboutPath,
      {
        maxAge: 0,
        setHeaders(res) {
          res.setHeader("Cache-Control", "no-store, max-age=0");
        },
      },
      (err) => {
        if (err) next(err);
      },
    );
  });
  app.get(["/about", "/about/"], (_req, res) => {
    res.redirect(302, "/about.html");
  });

  function sendRootHtml(file, routePath) {
    const fp = path.join(ROOT, file);
    app.get(routePath, (_req, res, next) => {
      res.sendFile(
        fp,
        {
          maxAge: 0,
          setHeaders(res) {
            res.setHeader("Cache-Control", "no-store, max-age=0");
          },
        },
        (err) => {
          if (err) next(err);
        },
      );
    });
  }
  sendRootHtml("contact.html", "/contact.html");
  sendRootHtml("messages.html", "/messages.html");
}

const LISTEN_HOST = process.env.LISTEN_HOST || "";

function listenCb() {
  var where = LISTEN_HOST ? LISTEN_HOST + ":" + PORT : "port " + PORT;
  console.log(
    SERVE_STATIC
      ? "Site and API at http://" + (LISTEN_HOST || "0.0.0.0") + ":" + PORT + " (API + static)"
      : "API only on " + where + " (static served elsewhere)",
  );
}

const server = http.createServer(app);
attachAdminMessagesRealtime(server, sessionMiddleware);

startInfoInboxRealtimeWatcher({ pool, notifyInboxChanged });

/** Fallback IMAP/Maildir poll when IDLE/maildir watch is unavailable or disabled (INFO_INBOX_PUSH=0). */
const DEFAULT_INFO_INBOX_POLL_MS = 60000;
const MIN_INFO_INBOX_POLL_MS = 5000;
const INFO_INBOX_POLL_MS_RAW = process.env.INFO_INBOX_POLL_MS;
const INFO_INBOX_POLL_MS =
  INFO_INBOX_POLL_MS_RAW === undefined || INFO_INBOX_POLL_MS_RAW === ""
    ? DEFAULT_INFO_INBOX_POLL_MS
    : Number(INFO_INBOX_POLL_MS_RAW);
let infoInboxPollMs = INFO_INBOX_POLL_MS;
if (infoInboxPollMs !== 0) {
  if (!Number.isFinite(infoInboxPollMs) || infoInboxPollMs < 0) {
    console.warn(
      "[info-inbox poll] invalid INFO_INBOX_POLL_MS; using default",
      DEFAULT_INFO_INBOX_POLL_MS,
    );
    infoInboxPollMs = DEFAULT_INFO_INBOX_POLL_MS;
  } else if (infoInboxPollMs > 0 && infoInboxPollMs < MIN_INFO_INBOX_POLL_MS) {
    console.warn(
      "[info-inbox poll] INFO_INBOX_POLL_MS below minimum; clamping to",
      MIN_INFO_INBOX_POLL_MS,
    );
    infoInboxPollMs = MIN_INFO_INBOX_POLL_MS;
  }
}
/** Drop unverified signups once their OTP window has passed (see authRoutes OTP_TTL_MS). */
const PENDING_REG_CLEANUP_MS = 30 * 1000;
deleteStalePendingRegistrations().catch((err) => {
  console.error("[auth] pending registration cleanup (startup):", err.message || err);
});
setInterval(() => {
  deleteStalePendingRegistrations().catch((err) => {
    console.error("[auth] pending registration cleanup:", err.message || err);
  });
}, PENDING_REG_CLEANUP_MS);

if (infoInboxPollMs > 0) {
  let infoInboxPollRunning = false;
  setInterval(async () => {
    if (infoInboxPollRunning) return;
    infoInboxPollRunning = true;
    try {
      const syncResult = await syncInfoInbox(pool).catch((err) => {
        console.error("[info-inbox poll] sync:", err.message);
        return null;
      });
      if (syncResult && !syncResult.skipped && syncResult.newInfoRows === true) {
        notifyInboxChanged();
      }
    } catch (err) {
      console.error("[info-inbox poll]", err.message);
    } finally {
      infoInboxPollRunning = false;
    }
  }, infoInboxPollMs);
}

if (LISTEN_HOST) {
  server.listen(PORT, LISTEN_HOST, listenCb);
} else {
  server.listen(PORT, listenCb);
}
