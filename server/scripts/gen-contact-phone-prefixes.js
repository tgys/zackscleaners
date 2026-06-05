"use strict";

/**
 * Refreshes <option> lists for contact and recruitment country codes in ../../contact.html
 * from libphonenumber-js (E.164 / ITU-style prefixes, same family as Wikipedia’s telephone
 * country code list).
 *
 * Usage: node scripts/gen-contact-phone-prefixes.js
 */

const fs = require("fs");
const path = require("path");
const { getCountries, getCountryCallingCode } = require("libphonenumber-js");

const ROOT = path.join(__dirname, "..", "..");
const CONTACT_HTML = path.join(ROOT, "contact.html");

const SELECT_IDS = ["contact-phone-prefix", "recruitment-phone-prefix"];

function escOptionText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildOptionsLines() {
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  /** @type {Map<string, { iso: string; name: string }[]>} */
  const byPrefix = new Map();

  for (const iso of getCountries()) {
    const cc = getCountryCallingCode(iso);
    const prefix = `+${cc}`;
    const rawName = display.of(iso);
    const name = rawName && rawName !== iso ? rawName : iso;
    let list = byPrefix.get(prefix);
    if (!list) {
      list = [];
      byPrefix.set(prefix, list);
    }
    list.push({ iso, name });
  }

  for (const [, list] of byPrefix) {
    list.sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  const rows = [...byPrefix.entries()].map(([prefix, territories]) => {
    const label = territories.map((t) => t.name).join(" · ");
    return { prefix, label: `${prefix} — ${label}` };
  });

  rows.sort((a, b) => {
    const na = Number.parseInt(a.prefix.slice(1), 10);
    const nb = Number.parseInt(b.prefix.slice(1), 10);
    if (na !== nb) return na - nb;
    return a.label.localeCompare(b.label, "en");
  });

  const lines = [];
  for (const { prefix, label } of rows) {
    const selected = prefix === "+1" ? " selected" : "";
    lines.push(`          <option value="${prefix}"${selected}>${escOptionText(label)}</option>`);
  }
  return lines.join("\n");
}

/**
 * @param {string} html
 * @param {string} optionsBlock
 */
function injectOptionsIntoSelects(html, optionsBlock) {
  let out = html;
  for (const id of SELECT_IDS) {
    const re = new RegExp(`(<select\\s+id="${id}"[^>]*>)([\\s\\S]*?)(</select>)`, "i");
    if (!re.test(out)) {
      throw new Error(`Missing <select id="${id}"> in contact.html`);
    }
    out = out.replace(re, `$1\n${optionsBlock}\n        $3`);
  }
  return out;
}

function main() {
  const options = buildOptionsLines();
  const html = fs.readFileSync(CONTACT_HTML, "utf8");
  const next = injectOptionsIntoSelects(html, options);
  fs.writeFileSync(CONTACT_HTML, next, "utf8");
  console.error(
    `Updated ${path.relative(ROOT, CONTACT_HTML)} (${options.split("\n").length} options × ${SELECT_IDS.length} selects).`,
  );
}

main();
