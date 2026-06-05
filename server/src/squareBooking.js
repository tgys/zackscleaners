"use strict";

const { SquareClient, SquareEnvironment } = require("square");

function squareBookingEnabled() {
  const token = String(process.env.SQUARE_ACCESS_TOKEN || "").trim();
  const appId = String(process.env.SQUARE_APPLICATION_ID || "").trim();
  const locId = String(process.env.SQUARE_LOCATION_ID || "").trim();
  return Boolean(token && appId && locId);
}

function squareEnvironmentName() {
  return String(process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function getSquareApplicationId() {
  return String(process.env.SQUARE_APPLICATION_ID || "").trim();
}

function getSquareLocationId() {
  return String(process.env.SQUARE_LOCATION_ID || "").trim();
}

let _squareClient;

function getSquareClient() {
  if (!_squareClient && squareBookingEnabled()) {
    const token = String(process.env.SQUARE_ACCESS_TOKEN || "").trim();
    _squareClient = new SquareClient({
      token,
      environment:
        squareEnvironmentName() === "production"
          ? SquareEnvironment.Production
          : SquareEnvironment.Sandbox,
    });
  }
  return _squareClient;
}

/**
 * Logs when SQUARE_ENVIRONMENT does not match the obvious credential flavor.
 * Sandbox app IDs commonly include `sandbox-`; production app IDs commonly use sq0idp- form.
 */
function warnIfSquareCredentialMismatch() {
  if (!squareBookingEnabled()) return;
  const env = squareEnvironmentName();
  const appId = getSquareApplicationId();
  const sandboxish = /^sandbox-/i.test(appId) || /\bsandbox\b/i.test(appId);
  const prodish = /^sq0idp-/i.test(appId);

  if (env === "production" && sandboxish) {
    console.warn(
      `[square] SQUARE_ENVIRONMENT is production but SQUARE_APPLICATION_ID looks like Sandbox (${appId.slice(0, 24)}…). ` +
        "Use production Application ID, Location ID, and Access Token together, or set SQUARE_ENVIRONMENT=sandbox.",
    );
  } else if (env === "sandbox" && prodish) {
    console.warn(
      "[square] SQUARE_ENVIRONMENT is sandbox but SQUARE_APPLICATION_ID looks like a production Application ID. " +
        "Use sandbox credentials with SQUARE_ENVIRONMENT=sandbox, or switch to production tokens and production.",
    );
  }
}

module.exports = {
  squareBookingEnabled,
  squareEnvironmentName,
  getSquareApplicationId,
  getSquareLocationId,
  getSquareClient,
  warnIfSquareCredentialMismatch,
};
