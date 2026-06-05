"use strict";

/** Starting USD tariff amounts (cents) — must stay aligned with bookings.html option labels. */
const BASE_USD_CENTS = Object.freeze({
  "studio-1br": 4800,
  "apt-2br": 6500,
  "home-3br": 9000,
  deep: 12500,
  "move-in-out": 15000,
  "office-small": 6000,
  "plan-weekly": 4300,
  "plan-biweekly": 5000,
  "plan-monthly": 6000,
  "post-construction": 17500,
  "tip-2": 200,
});

const ADDON_USD_CENTS = Object.freeze({
  bathroom: 1300,
  oven: 2000,
  fridge: 1800,
  windows: 2500,
});

const CLEANING_LABELS = Object.freeze({
  "studio-1br": "Studio / 1 BR standard clean",
  "apt-2br": "Apartment 2 BR standard clean",
  "home-3br": "Home 3+ BR standard clean",
  deep: "Deep clean",
  "move-in-out": "Move-in / move-out clean",
  "office-small": "Small office clean",
  "plan-weekly": "Weekly plan",
  "plan-biweekly": "Bi-weekly plan",
  "plan-monthly": "Monthly plan",
  "post-construction": "Post-construction clean",
  "tip-2": "$2 tip",
});

function cleaningTypeLabel(cleaningType) {
  return CLEANING_LABELS[cleaningType] || "Cleaning service";
}

function bookingQuoteUsdCents(cleaningType, uniqueAddons) {
  const base = BASE_USD_CENTS[cleaningType];
  if (base == null) return null;
  let sum = base;
  for (let i = 0; i < uniqueAddons.length; i++) {
    const add = ADDON_USD_CENTS[uniqueAddons[i]];
    if (add == null) return null;
    sum += add;
  }
  return sum;
}

const TIP_CLEANING_TYPE = "tip-2";

function isTipCleaningType(cleaningType) {
  return cleaningType === TIP_CLEANING_TYPE;
}

/** Paid tips are complete once Stripe succeeds; cleanings still need admin approval. */
function bookingStatusAfterPaidCheckout(cleaningType) {
  return isTipCleaningType(cleaningType) ? "confirmed" : "pending_confirmation";
}

module.exports = {
  BASE_USD_CENTS,
  ADDON_USD_CENTS,
  CLEANING_LABELS,
  cleaningTypeLabel,
  bookingQuoteUsdCents,
  isTipCleaningType,
  bookingStatusAfterPaidCheckout,
};
