"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { pool } = require("./db");
const { getStripeClient, stripeBookingEnabled } = require("./stripeBooking");
const { sendSms, smsConfigured } = require("./sms");
const { sendMail, mailConfigured } = require("./mail");
const { adminInboxReplyEmail } = require("./emailTemplates");
const { EMAIL_RE, NAME_CTRL_RE } = require("./inputValidators");
const {
  getBusinessSignatureSettings,
  updateBusinessSignatureSettings,
} = require("./businessSettings");
const {
  getInfoEmailAddress,
  getNoreplyFromHeader,
  getInfoFromHeader,
  getNoreplyMailboxTag,
} = require("./mailAddresses");
const { syncInfoInbox } = require("./infoInboxSync");
const { notifyInboxChanged, notifySentChanged } = require("./adminMessagesRealtime");
const {
  bannerLogoPngAttachment,
  SIGNATURE_LOGO_CID,
} = require("./emailSignatureLogo");

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STORED_CV_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

const RECRUITMENT_CV_DIR =
  process.env.RECRUITMENT_CV_DIR ||
  path.join(__dirname, "..", "data", "recruitment-cvs");

const INBOX_REPLY_MAX_CHARS = 20000;

function trimSignatureField(val, max) {
  const t = val == null ? "" : String(val).trim();
  if (t.length > max) return null;
  return t;
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

router.use(requireAdmin);

const TIP_CLEANING_TYPE = "tip-2";

const BOOKING_LIST_STATUSES = new Set([
  "pending_confirmation",
  "confirmed",
  "in_progress",
  "completed",
  "rejected",
  "cancelled",
  "refunded",
  "removed_by_admin",
]);

const BOOKING_SETTABLE_STATUSES = new Set([
  "pending_confirmation",
  "confirmed",
  "in_progress",
  "completed",
  "rejected",
  "cancelled",
]);

function parseTipsOnlyQuery(req) {
  const raw = String(req.query.tips_only || req.query.filter || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "tips" || raw === "tip";
}

function parseStatusFilter(req) {
  const raw = String(req.query.status || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "any") return null;
  if (!BOOKING_LIST_STATUSES.has(raw)) return "invalid";
  return raw;
}

function parseAssignedToFilter(req) {
  const raw = String(req.query.assigned_to || req.query.assigned_employee_id || "").trim();
  if (!raw || raw === "all" || raw === "any") return { mode: "any" };
  if (raw === "unassigned" || raw === "none") return { mode: "unassigned" };
  if (UUID_RE.test(raw)) return { mode: "employee", employeeId: raw };
  return { mode: "invalid" };
}

function trimEmployeeField(val, max) {
  const t = val == null ? "" : String(val).trim();
  if (t.length > max) return null;
  return t;
}

async function stripeRefundBookingPayment(paymentId, bookingId, adminAction) {
  if (!stripeBookingEnabled()) {
    const err = new Error("Stripe is not configured.");
    err.status = 503;
    throw err;
  }
  const stripe = getStripeClient();
  const refund = await stripe.refunds.create({
    payment_intent: paymentId,
    reason: "requested_by_customer",
    metadata: {
      booking_id: bookingId,
      admin_action: adminAction,
    },
  });
  const refundId = refund && refund.id ? String(refund.id) : null;
  const refundStatusSnap = refund && refund.status != null ? String(refund.status) : null;
  if (!refundId) {
    const err = new Error("Stripe refund response was incomplete.");
    err.status = 502;
    throw err;
  }
  if (refundStatusSnap === "failed") {
    const err = new Error("Stripe reported the refund failed.");
    err.status = 402;
    throw err;
  }
  return { refundId, refundStatusSnap };
}

router.get("/employees", async (req, res) => {
  try {
    const activeOnly = String(req.query.active_only || "").trim() === "1" ||
      String(req.query.active_only || "").trim().toLowerCase() === "true";
    const q = await pool.query(
      activeOnly
        ? `
          SELECT id, name, email, phone, active, created_at, updated_at
          FROM employees
          WHERE active = true
          ORDER BY name ASC
        `
        : `
          SELECT id, name, email, phone, active, created_at, updated_at
          FROM employees
          ORDER BY active DESC, name ASC
        `,
    );
    res.json({ employees: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load employees." });
  }
});

router.post("/employees", async (req, res) => {
  try {
    const name = trimEmployeeField(req.body && req.body.name, 200);
    if (!name) {
      return res.status(400).json({ error: "Employee name is required." });
    }
    if (NAME_CTRL_RE.test(name)) {
      return res.status(400).json({ error: "Name contains invalid control characters." });
    }
    const emailRaw = trimEmployeeField(req.body && req.body.email, 254);
    const phone = trimEmployeeField(req.body && req.body.phone, 80);
    if (emailRaw === null || phone === null) {
      return res.status(400).json({ error: "A field is too long." });
    }
    let email = emailRaw ? emailRaw.toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Email address is invalid." });
    }
    if (phone && NAME_CTRL_RE.test(phone)) {
      return res.status(400).json({ error: "Phone contains invalid control characters." });
    }

    const ins = await pool.query(
      `
      INSERT INTO employees (name, email, phone, active)
      VALUES ($1, $2, $3, true)
      RETURNING id, name, email, phone, active, created_at, updated_at
    `,
      [name, email, phone || null],
    );
    res.status(201).json({ ok: true, employee: ins.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add employee." });
  }
});

router.put("/employees/:id", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid employee id." });
  }
  try {
    const name = trimEmployeeField(req.body && req.body.name, 200);
    if (!name) {
      return res.status(400).json({ error: "Employee name is required." });
    }
    if (NAME_CTRL_RE.test(name)) {
      return res.status(400).json({ error: "Name contains invalid control characters." });
    }
    const emailRaw = trimEmployeeField(req.body && req.body.email, 254);
    const phone = trimEmployeeField(req.body && req.body.phone, 80);
    if (emailRaw === null || phone === null) {
      return res.status(400).json({ error: "A field is too long." });
    }
    let email = emailRaw ? emailRaw.toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Email address is invalid." });
    }
    if (phone && NAME_CTRL_RE.test(phone)) {
      return res.status(400).json({ error: "Phone contains invalid control characters." });
    }
    const active =
      req.body && req.body.active === false ? false : req.body && req.body.active === true ? true : null;

    const up = await pool.query(
      `
      UPDATE employees
      SET name = $2,
          email = $3,
          phone = $4,
          active = COALESCE($5, active),
          updated_at = now()
      WHERE id = $1::uuid
      RETURNING id, name, email, phone, active, created_at, updated_at
    `,
      [id, name, email, phone || null, active],
    );
    if (up.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found." });
    }
    res.json({ ok: true, employee: up.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update employee." });
  }
});

router.delete("/employees/:id", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid employee id." });
  }
  try {
    const up = await pool.query(
      `
      UPDATE employees
      SET active = false, updated_at = now()
      WHERE id = $1::uuid
      RETURNING id, name, active
    `,
      [id],
    );
    if (up.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found." });
    }
    res.json({ ok: true, employee: up.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not deactivate employee." });
  }
});

router.get("/bookings", async (req, res) => {
  try {
    const tipsOnly = parseTipsOnlyQuery(req);
    const statusFilter = parseStatusFilter(req);
    if (statusFilter === "invalid") {
      return res.status(400).json({ error: "Invalid status filter." });
    }
    const assignedFilter = parseAssignedToFilter(req);
    if (assignedFilter.mode === "invalid") {
      return res.status(400).json({ error: "Invalid assigned-to filter." });
    }

    const q = await pool.query(
      `
      SELECT
        b.id,
        b.user_id,
        u.email,
        u.name,
        b.address,
        b.cleaning_type,
        b.addons,
        b.notes,
        b.status,
        b.cancelled_at,
        b.created_at,
        b.updated_at,
        b.square_payment_id,
        b.checkout_amount_cents,
        b.square_refund_id,
        b.square_refund_status,
        b.assigned_employee_id,
        e.name AS assigned_employee_name,
        (b.cleaning_type = $1) AS is_tip
      FROM bookings b
      INNER JOIN users u ON u.id = b.user_id
      LEFT JOIN employees e ON e.id = b.assigned_employee_id
      WHERE b.admin_removed_at IS NULL
        AND ($2::boolean IS NOT TRUE OR b.cleaning_type = $1)
        AND ($3::text IS NULL OR b.status = $3)
        AND (
          $4::text = 'any'
          OR ($4::text = 'unassigned' AND b.assigned_employee_id IS NULL)
          OR b.assigned_employee_id = $5::uuid
        )
      ORDER BY
        CASE b.status
          WHEN 'pending_confirmation' THEN 0
          WHEN 'confirmed' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'completed' THEN 3
          ELSE 4
        END,
        b.created_at DESC
    `,
      [
        TIP_CLEANING_TYPE,
        tipsOnly,
        statusFilter,
        assignedFilter.mode === "employee" ? "employee" : assignedFilter.mode,
        assignedFilter.mode === "employee" ? assignedFilter.employeeId : null,
      ],
    );
    res.json({
      bookings: q.rows,
      filter: {
        tipsOnly: tipsOnly,
        status: statusFilter || "all",
        assignedTo: assignedFilter.mode === "employee" ? assignedFilter.employeeId : assignedFilter.mode,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load bookings." });
  }
});

router.post("/bookings/:id/confirm", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid booking id." });
  }
  try {
    const r = await pool.query(
      `
      UPDATE bookings
      SET status = 'confirmed', updated_at = now()
      WHERE id = $1::uuid
        AND admin_removed_at IS NULL
        AND status = 'pending_confirmation'
      RETURNING id, status, cleaning_type
    `,
      [id],
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ error: "Booking not found or not awaiting approval." });
    }
    res.json({ ok: true, booking: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not confirm booking." });
  }
});

router.post("/bookings/:id/reject", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid booking id." });
  }
  try {
    const r = await pool.query(
      `
      UPDATE bookings
      SET status = 'rejected',
          cancelled_at = now(),
          updated_at = now()
      WHERE id = $1::uuid
        AND admin_removed_at IS NULL
        AND status = 'pending_confirmation'
      RETURNING id, status, cleaning_type
    `,
      [id],
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ error: "Booking not found or not awaiting approval." });
    }
    res.json({ ok: true, booking: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not reject booking." });
  }
});

/** Refund card payment via Stripe; booking stays on the overview list. */
router.post("/bookings/:id/refund", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid booking id." });
  }

  let pgClient;
  try {
    pgClient = await pool.connect();
    await pgClient.query("BEGIN");
    const locked = await pgClient.query(
      `SELECT id, square_payment_id, checkout_amount_cents, admin_removed_at, square_refund_id, status
       FROM bookings WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (locked.rows.length === 0) {
      await pgClient.query("ROLLBACK");
      return res.status(404).json({ error: "Booking not found." });
    }
    const row = locked.rows[0];
    if (row.admin_removed_at != null) {
      await pgClient.query("ROLLBACK");
      return res.status(409).json({ error: "This booking has been removed from the dashboard." });
    }
    if (row.square_refund_id || row.status === "refunded") {
      await pgClient.query("ROLLBACK");
      return res.status(409).json({ error: "This booking has already been refunded." });
    }

    const paymentId = row.square_payment_id ? String(row.square_payment_id).trim() : "";
    const amountCents = row.checkout_amount_cents != null ? Number(row.checkout_amount_cents) : NaN;
    const canRefund = Boolean(
      paymentId && paymentId.startsWith("pi_") && Number.isFinite(amountCents) && amountCents > 0,
    );
    if (!canRefund) {
      await pgClient.query("ROLLBACK");
      return res.status(400).json({ error: "No refundable card payment on record for this booking." });
    }

    let refundId;
    let refundStatusSnap;
    try {
      const refunded = await stripeRefundBookingPayment(paymentId, id, "refund");
      refundId = refunded.refundId;
      refundStatusSnap = refunded.refundStatusSnap;
    } catch (payErr) {
      await pgClient.query("ROLLBACK");
      console.error("[admin/bookings refund]", payErr);
      return res.status(payErr.status || 402).json({
        error: payErr.message || "Could not complete refund via Stripe.",
      });
    }

    const up = await pgClient.query(
      `
      UPDATE bookings
      SET status = 'refunded',
          square_refund_id = $2,
          square_refund_status = $3,
          updated_at = now()
      WHERE id = $1::uuid
      RETURNING id, status, cleaning_type, square_refund_id
    `,
      [id, refundId, refundStatusSnap],
    );
    await pgClient.query("COMMIT");
    res.json({ ok: true, booking: up.rows[0], refunded: true, stripeRefundId: refundId });
  } catch (err) {
    if (pgClient) await pgClient.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Could not refund booking." });
  } finally {
    if (pgClient) pgClient.release();
  }
});

router.patch("/bookings/:id/assign", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid booking id." });
  }

  let employeeId = req.body && req.body.employeeId;
  if (employeeId === "" || employeeId === undefined) employeeId = null;
  if (employeeId != null && !UUID_RE.test(String(employeeId))) {
    return res.status(400).json({ error: "Invalid employee id." });
  }

  try {
    if (employeeId) {
      const emp = await pool.query(
        `SELECT id, name FROM employees WHERE id = $1::uuid AND active = true LIMIT 1`,
        [employeeId],
      );
      if (emp.rows.length === 0) {
        return res.status(404).json({ error: "Employee not found or inactive." });
      }
    }

    const up = await pool.query(
      `
      UPDATE bookings
      SET assigned_employee_id = $2,
          updated_at = now()
      WHERE id = $1::uuid AND admin_removed_at IS NULL
      RETURNING id, assigned_employee_id, status
    `,
      [id, employeeId],
    );
    if (up.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found." });
    }

    let assignedEmployeeName = null;
    if (employeeId) {
      const emp = await pool.query(`SELECT name FROM employees WHERE id = $1::uuid`, [employeeId]);
      assignedEmployeeName = emp.rows[0] ? emp.rows[0].name : null;
    }

    res.json({
      ok: true,
      booking: Object.assign({}, up.rows[0], {
        assigned_employee_name: assignedEmployeeName,
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not assign cleaner." });
  }
});

router.patch("/bookings/:id/status", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid booking id." });
  }

  const status = String((req.body && req.body.status) || "").trim();
  if (!BOOKING_SETTABLE_STATUSES.has(status)) {
    return res.status(400).json({ error: "Invalid booking status." });
  }

  try {
    const up = await pool.query(
      `
      UPDATE bookings
      SET status = $2,
          cancelled_at = CASE WHEN $2 IN ('rejected', 'cancelled') THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
          updated_at = now()
      WHERE id = $1::uuid AND admin_removed_at IS NULL
      RETURNING id, status, cleaning_type, assigned_employee_id
    `,
      [id, status],
    );
    if (up.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found." });
    }
    res.json({ ok: true, booking: up.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update booking status." });
  }
});

/** Soft-remove from admin lists; refunds Stripe payment when checkout metadata exists. */
router.post("/bookings/:id/refund-and-remove", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid booking id." });
  }

  let pgClient;
  try {
    pgClient = await pool.connect();
    await pgClient.query("BEGIN");
    const locked = await pgClient.query(
      `SELECT id, square_payment_id, checkout_amount_cents, admin_removed_at
       FROM bookings WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (locked.rows.length === 0) {
      await pgClient.query("ROLLBACK");
      return res.status(404).json({ error: "Booking not found." });
    }
    const row = locked.rows[0];
    if (row.admin_removed_at != null) {
      await pgClient.query("ROLLBACK");
      return res.status(409).json({
        error: "This booking has already been removed from the dashboard.",
      });
    }

    const paymentId = row.square_payment_id ? String(row.square_payment_id).trim() : "";
    const amtRaw = row.checkout_amount_cents;
    const amountCents = amtRaw != null ? Number(amtRaw) : NaN;
    const canRefund = Boolean(
      paymentId && paymentId.startsWith("pi_") && Number.isFinite(amountCents) && amountCents > 0,
    );

    let refundId = null;
    let refundStatusSnap = null;

    if (canRefund) {
      if (!stripeBookingEnabled()) {
        await pgClient.query("ROLLBACK");
        return res.status(503).json({
          error:
            "Stripe is not configured (STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY). Cannot refund this card payment.",
        });
      }

      try {
        const refunded = await stripeRefundBookingPayment(paymentId, id, "refund-and-remove");
        refundId = refunded.refundId;
        refundStatusSnap = refunded.refundStatusSnap;
      } catch (payErr) {
        await pgClient.query("ROLLBACK");
        console.error("[admin/bookings refund]", payErr);
        return res.status(payErr.status || 402).json({
          error: payErr.message || "Could not complete refund via Stripe.",
        });
      }
    }

    const newStatus = canRefund ? "refunded" : "removed_by_admin";
    const up = await pgClient.query(
      `
      UPDATE bookings
      SET admin_removed_at = now(),
          status = $2,
          square_refund_id = COALESCE($3, square_refund_id),
          square_refund_status = COALESCE($4, square_refund_status),
          updated_at = now()
      WHERE id = $1::uuid AND admin_removed_at IS NULL
      RETURNING id, status, cleaning_type
    `,
      [id, newStatus, refundId, refundStatusSnap],
    );

    if (up.rows.length === 0) {
      await pgClient.query("ROLLBACK");
      return res.status(409).json({ error: "Booking state changed concurrently; reload and retry." });
    }

    await pgClient.query("COMMIT");
    res.json({
      ok: true,
      booking: up.rows[0],
      refunded: canRefund,
      stripeRefundId: refundId,
    });
  } catch (err) {
    if (pgClient) await pgClient.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Could not refund or remove booking." });
  } finally {
    if (pgClient) pgClient.release();
  }
});

router.get("/users", async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT id, email, name, address, created_at, last_login_at, email_verified_at
      FROM users
      ORDER BY created_at DESC
    `);
    res.json({ users: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load users." });
  }
});

router.get("/users/:id", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid user id." });
  }
  try {
    const u = await pool.query(
      `
      SELECT id, email, name, address, created_at, last_login_at, email_verified_at
      FROM users WHERE id = $1 LIMIT 1
    `,
      [id],
    );
    if (u.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    const b = await pool.query(
      `
      SELECT id, address, cleaning_type, addons, notes, status, cancelled_at, created_at,
             admin_removed_at, square_refund_id, square_refund_status, square_payment_id,
             checkout_amount_cents
      FROM bookings
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
      [id],
    );
    const rows = b.rows;
    const isCancelled = function (row) {
      return row.status === "cancelled" || row.cancelled_at != null;
    };
    const cancellations = rows.filter(isCancelled);
    const bookings = rows.filter(function (row) {
      return !isCancelled(row);
    });
    res.json({
      user: u.rows[0],
      bookings,
      cancellations,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load user." });
  }
});

router.get("/business-settings", async (_req, res) => {
  try {
    const settings = await getBusinessSignatureSettings();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load settings." });
  }
});

router.put("/business-settings", async (req, res) => {
  try {
    const displayName = trimSignatureField(req.body && req.body.displayName, 200);
    const phone = trimSignatureField(req.body && req.body.phone, 80);
    const address = trimSignatureField(req.body && req.body.address, 2000);
    const signatureEmailRaw = trimSignatureField(req.body && req.body.signatureEmail, 254);
    if (
      displayName === null ||
      phone === null ||
      address === null ||
      signatureEmailRaw === null
    ) {
      return res.status(400).json({ error: "A field is too long." });
    }
    if (
      NAME_CTRL_RE.test(displayName) ||
      NAME_CTRL_RE.test(phone) ||
      NAME_CTRL_RE.test(address)
    ) {
      return res.status(400).json({ error: "Fields contain invalid control characters." });
    }
    let signatureEmail = String(signatureEmailRaw || "").trim().toLowerCase();
    if (signatureEmail && (!EMAIL_RE.test(signatureEmail) || signatureEmail.length > 254)) {
      return res.status(400).json({ error: "Signature email address is invalid." });
    }

    await updateBusinessSignatureSettings({ displayName, phone, address, signatureEmail });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save settings." });
  }
});

/** Smoke-test Twilio SMS (admin only). Body: { "to": "+15551234567", "body": "optional" } */
router.post("/sms-test", async (req, res) => {
  try {
    if (!smsConfigured()) {
      return res.status(503).json({
        error:
          "Twilio SMS env vars are not set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or API keys, Twilio From / Messaging Service).",
      });
    }
    var to = req.body && req.body.to;
    var body =
      (req.body && req.body.body && String(req.body.body).trim()) ||
      "Zack's Maids — SMS test from admin.";
    var result = await sendSms({ to: to, body: body });
    if (result.skipped && result.error) {
      return res.status(400).json({ error: result.error });
    }
    if (result.error) {
      return res.status(502).json({ error: result.error });
    }
    res.json({ ok: true, sid: result.sid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "SMS test failed." });
  }
});

module.exports = { router };
