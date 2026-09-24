/**
 * tests/unit/db-migration-runner-fork-namespace.test.ts
 *
 * Fork migrations live in `MIGRATIONS_DIR/fork/` and are recorded as `fork-NNN`
 * (src/lib/db/migrationRunner/forkMigrations.ts), so a fork migration can never
 * take one of upstream's numeric slots. A database that already applied the
 * fork's former `190_call_logs_upstream_response_model` must hand slot 190 back
 * to upstream's `190_call_logs_content_provenance` and keep the fork migration
 * recorded as `fork-001` without replaying it.
 *
 * Same test shape as db-migration-runner-extra-dirs.test.ts: `MIGRATIONS_DIR` is
 * resolved once at module evaluation, so the core directory is fixed before the
 * first import, and tests are registered without top-level `await`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const CORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mig-fork-core-"));
fs.mkdirSync(path.join(CORE_DIR, "fork"));
fs.writeFileSync(
  path.join(CORE_DIR, "190_call_logs_content_provenance.sql"),
  "CREATE TABLE upstream_190 (id INTEGER);",
  "utf-8"
);
fs.writeFileSync(
  path.join(CORE_DIR, "fork", "001_call_logs_upstream_response_model.sql"),
  "CREATE TABLE fork_001 (id INTEGER);",
  "utf-8"
);
process.env.OMNIROUTE_MIGRATIONS_DIR = CORE_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
delete process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;

const { runMigrations } = await import("../../src/lib/db/migrationRunner.ts");

process.on("exit", () => {
  try {
    fs.rmSync(CORE_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* ignore */
  }
});

function ledger(db: Database.Database): Array<{ version: string; name: string }> {
  return db
    .prepare("SELECT version, name FROM _omniroute_migrations ORDER BY rowid")
    .all() as Array<{ version: string; name: string }>;
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

test("fork migrations apply after upstream under the fork-NNN namespace", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db as never, { isNewDb: true });
    assert.deepEqual(ledger(db), [
      { version: "190", name: "call_logs_content_provenance" },
      { version: "fork-001", name: "call_logs_upstream_response_model" },
    ]);
    assert.ok(hasTable(db, "upstream_190"));
    assert.ok(hasTable(db, "fork_001"));
  } finally {
    db.close();
  }
});

test("a legacy 190_call_logs_upstream_response_model ledger row moves to fork-001", () => {
  const db = new Database(":memory:");
  try {
    // Simulate a database migrated by the old fork build: the fork migration
    // ran in upstream's slot 190 and upstream's own 190 never ran.
    db.exec(`
      CREATE TABLE _omniroute_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE fork_001 (id INTEGER);
      INSERT INTO _omniroute_migrations (version, name)
        VALUES ('190', 'call_logs_upstream_response_model');
    `);

    runMigrations(db as never, { isNewDb: false });

    const rows = ledger(db);
    assert.deepEqual(rows.map((r) => `${r.version}_${r.name}`).sort(), [
      "190_call_logs_content_provenance",
      "fork-001_call_logs_upstream_response_model",
    ]);
    assert.ok(hasTable(db, "upstream_190"), "upstream 190 must run once the slot is freed");
  } finally {
    db.close();
  }
});
