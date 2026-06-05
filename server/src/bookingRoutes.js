"use strict";

const express = require("express");
const argon2 = require("argon2");
const { pool } = require("./db");
const { bookingQuoteUsdCents, cleaningTypeLabel, bookingStatusAfterPaidCheckout, isTipCleaningType } =
  require("./bookingPricing");
const {
  stripeBookingEnabled,
  stripeKeyMode,
  getStripePublishableKey,
  getStripeClient,
} = require("./stripeBooking");

const router = express.Router();

const ALLOWED_CLEANING_TYPES = new Set([
  "studio-1br",
  "apt-2br",
  "home-3br",
  "deep",
  "move-in-out",
  "office-small",
  "plan-weekly",
  "plan-biweekly",
  "plan-monthly",
  "post-construction",
  "tip-2",
]);

const ALLOWED_ADDONS = new Set(["bathroom", "oven", "fridge", "windows"]);

const MAX_ADDRESS = 500;
const MAX_NOTES = 2000;
const MIN_REGISTER_PASSWORD = 12;
const MAX_PASSWORD = 256;

const BOOKING_ARGON2 = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

function requireCustomer(req, res, next) {
  if (req.session.isAdmin) {
    return res.status(403).json({
      error: "Sign in with a customer account to request a booking (not the admin login).",
    });
  }
  if (!req.session.userId) {
    return res.status(401).json({ error: "Sign in to submit a booking request." });
  }
  next();
}

function asciiNotes(s) {
  if (typeof s !== "string") return "";
  return s.replace(/[^\x20-\x7E]/g, "").slice(0, MAX_NOTES);
}

function validateEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Normalize booking fields shared by legacy POST / and checkout. */
function normalizeBookingFields(body) {
  const cleaning_type = String(body.cleaning_type || "").trim();
  if (!ALLOWED_CLEANING_TYPES.has(cleaning_type)) {
    return { error: "Choose a valid cleaning type." };
  }

  let addons = body.addons;
  if (addons == null) {
    addons = [];
  } else if (!Array.isArray(addons)) {
    return { error: "Add-ons must be an array." };
  } else if (addons.length > 16) {
    return { error: "Too many add-ons." };
  }
  for (let i = 0; i < addons.length; i++) {
    const a = String(addons[i] || "").trim();
    if (!ALLOWED_ADDONS.has(a)) {
      return { error: "Invalid add-on: " + a };
    }
  }
  const uniqueAddons = [...new Set(addons.map((a) => String(a).trim()))];

  let address = body.address != null ? String(body.address).trim() : "";
  if (address.length > MAX_ADDRESS) {
    return { error: "Address is too long." };
  }
  if (!address) {
    address = null;
  }

  const notesRaw = body.notes != null ? String(body.notes) : "";
  const notes = asciiNotes(notesRaw);
  if (notesRaw.length > MAX_NOTES) {
    return { error: "Notes are too long." };
  }

  const quote = bookingQuoteUsdCents(cleaning_type, uniqueAddons);
  if (quote == null) {
    return { error: "Could not price this selection." };
  }

  return {
    cleaning_type,
    uniqueAddons,
    address,
    notes,
    quoteCents: quote,
  };
}

function validateClaimedAmount(body, quoteCents) {
  const claimedAmount = Number(body.amount_cents);
  if (!Number.isFinite(claimedAmount) || claimedAmount !== quoteCents || quoteCents < 50) {
    return { error: "Payment amount mismatch — refresh and try again." };
  }
  return null;
}

router.get("/checkout-config", (_req, res) => {
  if (!stripeBookingEnabled()) {
    return res.json({
      checkoutEnabled: false,
      publishableKey: null,
      mode: null,
    });
  }
  res.json({
    checkoutEnabled: true,
    publishableKey: getStripePublishableKey(),
    mode: stripeKeyMode(),
    checkoutUi: "payment_element",
  });
});

function validateEmbeddedReturnUrl(returnUrl) {
  const raw = String(returnUrl || "").trim();
  if (!raw.includes("{CHECKOUT_SESSION_ID}")) {
    return null;
  }
  try {
    const u = new URL(raw.replace("{CHECKOUT_SESSION_ID}", "cs_placeholder"));
    const siteOrigin = String(process.env.PUBLIC_SITE_ORIGIN || "https://zacks.cleaners.tesko.io").trim();
    if (u.origin !== new URL(siteOrigin).origin) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

async function verifyStripePaymentForCheckout(stripe, paymentIntentId, quoteCents) {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.status !== "succeeded") {
    return {
      ok: false,
      status: 402,
      error:
        intent.status === "requires_payment_method"
          ? "Payment was declined. Try another card."
          : "Payment did not complete. Check your card details or try again.",
    };
  }
  if (intent.amount !== quoteCents) {
    return { ok: false, status: 400, error: "Payment amount mismatch — refresh and try again." };
  }
  return { ok: true, paymentId: intent.id };
}

async function resolvePaidPaymentFromCheckoutSession(stripe, checkoutSessionId, quoteCents) {
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ["payment_intent"],
  });
  if (session.status !== "complete") {
    return {
      ok: false,
      status: 402,
      error:
        session.status === "open"
          ? "Payment was not completed — try again."
          : "Payment did not complete. Check your card details or try again.",
      stripeDetail: { status: session.status, payment_status: session.payment_status },
    };
  }
  if (session.payment_status !== "paid") {
    return {
      ok: false,
      status: 402,
      error: "Payment did not complete. Check your card details or try again.",
      stripeDetail: { status: session.status, payment_status: session.payment_status },
    };
  }
  if (session.amount_total !== quoteCents) {
    return { ok: false, status: 400, error: "Payment amount mismatch — refresh and try again." };
  }
  const pi =
    session.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent.id
      : String(session.payment_intent || "");
  if (!pi.startsWith("pi_")) {
    return { ok: false, status: 402, error: "Missing payment confirmation — try again." };
  }
  return { ok: true, paymentId: pi, sessionId: session.id };
}

router.post("/quote", (req, res) => {
  const normalized = normalizeBookingFields(req.body || {});
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }
  res.json({
    amount_cents: normalized.quoteCents,
    currency: "USD",
  });
});

/** Legacy unpaid booking — only when Stripe checkout is not configured. */
router.post("/", requireCustomer, async (req, res) => {
  if (stripeBookingEnabled()) {
    return res.status(400).json({
      error:
        "This server requires card checkout for bookings. Complete payment using Pay & submit booking.",
    });
  }

  try {
    const normalized = normalizeBookingFields(req.body || {});
    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }

    const userId = req.session.userId;
    const insert = await pool.query(
      `
      INSERT INTO bookings (user_id, address, cleaning_type, addons, notes, status)
      VALUES ($1, $2, $3, $4::jsonb, $5, 'pending_confirmation')
      RETURNING id, address, cleaning_type, addons, notes, status, created_at
    `,
      [
        userId,
        normalized.address,
        normalized.cleaning_type,
        JSON.stringify(normalized.uniqueAddons),
        normalized.notes || null,
      ],
    );

    const row = insert.rows[0];
    res.status(201).json({
      ok: true,
      booking: row,
      message:
        "Your request was saved. An administrator will confirm it before it is finalized on the schedule.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save booking." });
  }
});

/** Create a Stripe Embedded Checkout Session for step 3. */
router.post("/create-checkout-session", async (req, res) => {
  if (!stripeBookingEnabled()) {
    return res.status(503).json({
      error:
        "Online card checkout is not configured on this server (set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY).",
    });
  }

  try {
    const normalized = normalizeBookingFields(req.body || {});
    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }

    const amountErr = validateClaimedAmount(req.body || {}, normalized.quoteCents);
    if (amountErr) {
      return res.status(400).json(amountErr);
    }

    const returnUrl = validateEmbeddedReturnUrl(req.body.return_url);
    if (!returnUrl) {
      return res.status(400).json({ error: "Invalid checkout return URL." });
    }

    const guestEmail = String(req.body.email || req.session.email || "")
      .trim()
      .toLowerCase();
    const productName = "Zack's Maids — " + cleaningTypeLabel(normalized.cleaning_type);
    let description = normalized.address ? String(normalized.address).slice(0, 200) : null;
    if (normalized.uniqueAddons.length > 0) {
      const addonNote = "Add-ons: " + normalized.uniqueAddons.join(", ");
      description = description ? description + " · " + addonNote : addonNote;
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      mode: "payment",
      submit_type: "book",
      customer_email: guestEmail && validateEmail(guestEmail) ? guestEmail : undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: normalized.quoteCents,
            product_data: {
              name: productName.slice(0, 120),
              description: description ? description.slice(0, 200) : undefined,
            },
          },
          quantity: 1,
        },
      ],
      return_url: returnUrl,
      metadata: {
        cleaning_type: normalized.cleaning_type,
        addons: JSON.stringify(normalized.uniqueAddons).slice(0, 450),
      },
    });

    console.log(
      "[bookings/create-checkout-session]",
      session.id,
      normalized.quoteCents,
      normalized.cleaning_type,
    );

    res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (err) {
    console.error("[bookings/create-checkout-session]", err);
    res.status(500).json({ error: "Could not start checkout." });
  }
});

/** Return page helper — poll Embedded Checkout Session status after redirect. */
router.get("/checkout-session-status", async (req, res) => {
  if (!stripeBookingEnabled()) {
    return res.status(503).json({ error: "Checkout is not configured." });
  }

  const sessionId = String(req.query.session_id || "").trim();
  if (!sessionId.startsWith("cs_")) {
    return res.status(400).json({ error: "Missing checkout session." });
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.json({
      status: session.status,
      payment_status: session.payment_status,
      payment_intent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent && session.payment_intent.id,
      amount_total: session.amount_total,
    });
  } catch (err) {
    console.error("[bookings/checkout-session-status]", err);
    res.status(500).json({ error: "Could not read checkout session." });
  }
});

/** Create a Stripe PaymentIntent for the Payment Element on step 3. */
router.post("/create-intent", async (req, res) => {
  if (!stripeBookingEnabled()) {
    return res.status(503).json({
      error:
        "Online card checkout is not configured on this server (set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY).",
    });
  }

  try {
    const normalized = normalizeBookingFields(req.body || {});
    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }

    const amountErr = validateClaimedAmount(req.body || {}, normalized.quoteCents);
    if (amountErr) {
      return res.status(400).json(amountErr);
    }

    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.create({
      amount: normalized.quoteCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      payment_method_options: {
        card: {
          request_three_d_secure: "challenge",
        },
      },
      metadata: {
        cleaning_type: normalized.cleaning_type,
      },
    });

    res.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
    });
  } catch (err) {
    console.error("[bookings/create-intent]", err);
    res.status(500).json({ error: "Could not start payment." });
  }
});

/**
 * Paid checkout — verifies a succeeded Stripe PaymentIntent, then saves the booking.
 * Guests supply password + email (creates verified account); logged-in customers use session only.
 */
router.post("/checkout", async (req, res) => {
  if (!stripeBookingEnabled()) {
    return res.status(503).json({
      error:
        "Online card checkout is not configured on this server (set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY).",
    });
  }

  if (req.session.isAdmin) {
    return res.status(403).json({
      error:
        "Bookings must be submitted from a customer account. Sign out of admin or open a private window.",
    });
  }

  const paymentIntentId = String(req.body.paymentIntentId || "").trim();
  const checkoutSessionId = String(req.body.checkoutSessionId || "").trim();
  console.log(
    "[bookings/checkout] attempt",
    checkoutSessionId ? checkoutSessionId.slice(0, 14) : paymentIntentId.slice(0, 12),
    req.session.userId ? "session-user" : "guest",
  );

  try {
    const normalized = normalizeBookingFields(req.body || {});
    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }

    const amountErr = validateClaimedAmount(req.body || {}, normalized.quoteCents);
    if (amountErr) {
      return res.status(400).json(amountErr);
    }

    if (!checkoutSessionId.startsWith("cs_") && !paymentIntentId.startsWith("pi_")) {
      return res.status(400).json({ error: "Missing payment — complete checkout and retry." });
    }

    let userId = req.session.userId || null;
    let guestEmail = null;
    let password_hash = null;
    let guestName = null;

    if (!userId) {
      guestEmail = String(req.body.email || "")
        .trim()
        .toLowerCase();
      const pw = String(req.body.password || "");
      const pw2 = String(req.body.password_confirm || "");
      guestName = req.body.name != null ? String(req.body.name).trim() || null : null;

      if (!validateEmail(guestEmail)) {
        return res.status(400).json({ error: "Enter a valid email address." });
      }
      if (pw.length < MIN_REGISTER_PASSWORD || pw.length > MAX_PASSWORD) {
        return res.status(400).json({
          error: `Password must be between ${MIN_REGISTER_PASSWORD} and ${MAX_PASSWORD} characters.`,
        });
      }
      if (pw !== pw2) {
        return res.status(400).json({ error: "Password confirmation does not match." });
      }

      const exists = await pool.query(`SELECT id FROM users WHERE email = $1::citext LIMIT 1`, [
        guestEmail,
      ]);
      if (exists.rows.length > 0) {
        return res.status(409).json({
          error:
            "That email already has an account. Sign in with your password to book, or use another email.",
        });
      }

      password_hash = await argon2.hash(pw, BOOKING_ARGON2);
    }

    const stripe = getStripeClient();
    let paymentId = null;

    try {
      if (checkoutSessionId.startsWith("cs_")) {
        const paid = await resolvePaidPaymentFromCheckoutSession(
          stripe,
          checkoutSessionId,
          normalized.quoteCents,
        );
        if (!paid.ok) {
          return res.status(paid.status).json({
            error: paid.error,
            stripe: paid.stripeDetail || null,
          });
        }
        paymentId = paid.paymentId;
      } else {
        const paid = await verifyStripePaymentForCheckout(
          stripe,
          paymentIntentId,
          normalized.quoteCents,
        );
        if (!paid.ok) {
          return res.status(paid.status).json({ error: paid.error });
        }
        paymentId = paid.paymentId;
      }
    } catch (payErr) {
      console.error("[bookings/checkout] Stripe retrieve", payErr);
      return res.status(402).json({
        error: "Card payment failed. Verify details or use another payment method.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (!userId) {
        const insUser = await client.query(
          `INSERT INTO users (email, password_hash, name, email_verified_at, address)
           VALUES ($1::citext, $2, $3, now(), $4)
           RETURNING id`,
          [guestEmail, password_hash, guestName, normalized.address],
        );
        userId = insUser.rows[0].id;
      }

      const insertBooking = await client.query(
        `INSERT INTO bookings (user_id, address, cleaning_type, addons, notes, status, square_payment_id, checkout_amount_cents)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         RETURNING id, address, cleaning_type, addons, notes, status, created_at`,
        [
          userId,
          normalized.address,
          normalized.cleaning_type,
          JSON.stringify(normalized.uniqueAddons),
          normalized.notes || null,
          bookingStatusAfterPaidCheckout(normalized.cleaning_type),
          paymentId,
          normalized.quoteCents,
        ],
      );

      await client.query("COMMIT");

      delete req.session.isAdmin;
      req.session.userId = userId;
      req.session.email = guestEmail || req.session.email;

      const row = insertBooking.rows[0];
      res.status(201).json({
        ok: true,
        booking: row,
        message: isTipCleaningType(normalized.cleaning_type)
          ? "Thank you — your $2 tip was received."
          : "Payment received and your request was saved. An administrator will confirm it before it is finalized on the schedule.",
      });
    } catch (inner) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        "[bookings/checkout] DB failure after payment — manual Stripe reconciliation:",
        paymentId,
      );
      res.status(500).json({
        error:
          "Payment succeeded but saving your booking failed. Contact support with your email — reference payment id if needed.",
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not complete checkout." });
  }
});

module.exports = { router };
