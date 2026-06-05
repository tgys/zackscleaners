"use strict";

const Stripe = require("stripe");

function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}

function getStripePublishableKey() {
  return String(process.env.STRIPE_PUBLISHABLE_KEY || "").trim();
}

function stripeBookingEnabled() {
  return Boolean(getStripeSecretKey() && getStripePublishableKey());
}

function stripeKeyMode() {
  const sk = getStripeSecretKey();
  if (sk.startsWith("sk_live_")) return "live";
  if (sk.startsWith("sk_test_")) return "test";
  return "unknown";
}

let _stripeClient;

function getStripeClient() {
  if (!_stripeClient && stripeBookingEnabled()) {
    _stripeClient = new Stripe(getStripeSecretKey());
  }
  return _stripeClient;
}

/** Warn when publishable + secret keys are not both test or both live. */
function warnIfStripeCredentialMismatch() {
  if (!stripeBookingEnabled()) return;
  const pk = getStripePublishableKey();
  const sk = getStripeSecretKey();
  const pkLive = pk.startsWith("pk_live_");
  const pkTest = pk.startsWith("pk_test_");
  const skLive = sk.startsWith("sk_live_");
  const skTest = sk.startsWith("sk_test_");

  if ((pkLive && skTest) || (pkTest && skLive)) {
    console.warn(
      "[stripe] STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY look like different modes (test vs live). " +
        "Use matching pk_test_/sk_test_ or pk_live_/sk_live_ pairs from the same Stripe Dashboard mode.",
    );
  } else if (!pkLive && !pkTest) {
    console.warn("[stripe] STRIPE_PUBLISHABLE_KEY does not look like pk_test_ or pk_live_.");
  } else if (!skLive && !skTest) {
    console.warn("[stripe] STRIPE_SECRET_KEY does not look like sk_test_ or sk_live_.");
  }
}

module.exports = {
  stripeBookingEnabled,
  stripeKeyMode,
  getStripePublishableKey,
  getStripeSecretKey,
  getStripeClient,
  warnIfStripeCredentialMismatch,
};
