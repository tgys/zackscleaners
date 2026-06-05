/**
 * Runs ordered SQL files from ../migrations and records versions in schema_migrations.
 * Keeps the database portable: ship migrations with the repo; any Postgres can apply them.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
// Repo `.env` must win over host-wide DATABASE_URL (e.g. NixOS environment.variables).
require("dotenv").config({
  path: path.join(__dirname, "..", "..", ".env"),
  override: true,
});

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and configure.");
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error("No migrations directory at", MIGRATIONS_DIR);
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    for (const file of files) {
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (done.rows.length > 0) {
        console.log("skip", file);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log("apply", file);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
