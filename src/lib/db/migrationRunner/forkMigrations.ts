/**
 * forkMigrations.ts — the fork's own schema, in its own migration namespace.
 *
 * Fork seam: upstream owns the bare numeric version space (`NNN_name.sql` in
 * `MIGRATIONS_DIR`). A fork that drew from the same numbers would collide with
 * upstream's next migration on every sync — the runner would either refuse to
 * start or record one name for the slot and silently skip the other.
 *
 * Fork migrations therefore live in `MIGRATIONS_DIR/fork/` and are recorded as
 * `fork-NNN` through the same namespaced reader the runner uses for
 * `OMNIROUTE_EXTRA_MIGRATIONS_DIRS`, so they can never take an upstream slot.
 * The subdirectory ships automatically with the migrations directory (standalone
 * build copies it recursively; the numeric listing ignores non-`.sql` entries).
 *
 * Unlike an env-declared directory this one is built in: when it exists it is
 * required schema, and it applies after the upstream numeric set.
 */

import fs from "fs";
import path from "path";
import type { SqliteAdapter } from "../adapters/types";
import { readNamespacedMigrationFiles, type NamespacedMigrationFile } from "./extraDirs";
import { migrationConsole as console } from "./logger";

export const FORK_MIGRATIONS_NAMESPACE = "fork";
export const FORK_MIGRATIONS_SUBDIR = "fork";

/**
 * The subdirectory is discovered through the same listing of `migrationsDir`
 * the runner uses for its numeric files, so anything that substitutes that
 * listing (tests mocking the migrations directory) also hides the fork set.
 */
export function getForkMigrationFiles(migrationsDir: string): NamespacedMigrationFile[] {
  if (!fs.existsSync(migrationsDir)) return [];
  const entries = fs.readdirSync(migrationsDir) as unknown[];
  if (!entries.some((entry) => String(entry) === FORK_MIGRATIONS_SUBDIR)) return [];
  const dir = path.join(migrationsDir, FORK_MIGRATIONS_SUBDIR);
  if (!fs.statSync(dir).isDirectory()) return [];
  return readNamespacedMigrationFiles({ namespace: FORK_MIGRATIONS_NAMESPACE, dir });
}

/**
 * Fork migrations that an older fork build shipped inside upstream's numeric
 * space. Kept here rather than in upstream's RENAMED_MIGRATION_COMPATIBILITY so
 * the upstream table (and the tests pinning it) stay untouched.
 */
export const FORK_LEGACY_SLOT_MIGRATIONS = [
  {
    fromVersion: "190",
    fromName: "call_logs_upstream_response_model",
    toVersion: "fork-001",
    toName: "call_logs_upstream_response_model",
  },
] as const;

/**
 * Rewrite a legacy ledger row (`190_call_logs_upstream_response_model`) to its
 * fork namespace version before the runner reads the ledger, so upstream's own
 * migration in that slot is seen as pending and the fork one as applied. Runs
 * only when the fork file is on disk and the upstream slot now holds a
 * different migration; idempotent once the row has moved.
 */
export function reconcileForkLegacyMigrations(
  db: SqliteAdapter,
  files: Array<{ version: string; name: string }>
): void {
  for (const legacy of FORK_LEGACY_SLOT_MIGRATIONS) {
    const hasForkFile = files.some(
      (file) => file.version === legacy.toVersion && file.name === legacy.toName
    );
    const slotTakenByUpstream = files.some(
      (file) => file.version === legacy.fromVersion && file.name !== legacy.fromName
    );
    if (!hasForkFile || !slotTakenByUpstream) continue;

    const legacyRow = db
      .prepare("SELECT 1 FROM _omniroute_migrations WHERE version = ? AND name = ?")
      .get(legacy.fromVersion, legacy.fromName);
    if (!legacyRow) continue;

    const forkRow = db
      .prepare("SELECT 1 FROM _omniroute_migrations WHERE version = ?")
      .get(legacy.toVersion);
    if (forkRow) {
      db.prepare("DELETE FROM _omniroute_migrations WHERE version = ? AND name = ?").run(
        legacy.fromVersion,
        legacy.fromName
      );
    } else {
      db.prepare(
        "UPDATE _omniroute_migrations SET version = ?, name = ? WHERE version = ? AND name = ?"
      ).run(legacy.toVersion, legacy.toName, legacy.fromVersion, legacy.fromName);
    }
    console.warn(
      `[Migration] Moved fork migration ${legacy.fromVersion}_${legacy.fromName} to ` +
        `${legacy.toVersion}_${legacy.toName}; upstream slot ${legacy.fromVersion} is free again.`
    );
  }
}
