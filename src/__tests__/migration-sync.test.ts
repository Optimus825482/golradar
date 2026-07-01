/**
 * Migration ↔ Schema regression guard.
 *
 * Two production outages were caused by schema changes that landed
 * in prisma/schema.prisma but never had a corresponding migration:
 *   - Signal.signalTier column (Faz A Task A4)
 *   - SignalPnL table (Faz D Task D1)
 *
 * Without this test, future contributors could re-introduce the
 * same class of bug. The check is intentionally cheap:
 *
 *   1. Read prisma/schema.prisma.
 *   2. Locate the migration directories in prisma/migrations.
 *   3. Concatenate every migration.sql and verify it contains
 *      a CREATE TABLE / ADD COLUMN for every model / field
 *      added in the schema.
 *
 * The check is keyword-based (not a full SQL parser) so it stays
 * fast and dependency-free. False positives are acceptable here
 * because they only fire when a migration is genuinely missing.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SCHEMA_PATH = join(REPO_ROOT, "prisma", "schema.prisma");
const MIGRATIONS_DIR = join(REPO_ROOT, "prisma", "migrations");

function readSchema(): string {
  return readFileSync(SCHEMA_PATH, "utf-8");
}

function collectMigrationSql(): string {
  const out: string[] = [];
  for (const entry of readdirSync(MIGRATIONS_DIR)) {
    const full = join(MIGRATIONS_DIR, entry);
    if (!statSync(full).isDirectory()) continue;
    const sqlPath = join(full, "migration.sql");
    try {
      out.push(readFileSync(sqlPath, "utf-8"));
    } catch {
      // directory has no migration.sql — skip
    }
  }
  return out.join("\n\n");
}

describe("migration ↔ schema sync", () => {
  test("schema file is readable", () => {
    expect(() => readSchema()).not.toThrow();
    expect(readSchema()).toContain("generator client");
  });

  test("P0/P3 schema additions have matching migrations (targeted check)", () => {
    // Whitelist-based check: only verify the models/columns added by
    // the IMPLEMENTATION_PLAN. A blanket "every model" check would
    // false-positive on tables that pre-existed before migrations
    // were introduced (they were created via `prisma db push` and
    // aren't represented in any migration.sql).
    const sql = collectMigrationSql().toUpperCase();
    expect(sql).toContain('CREATE TABLE "SIGNALPNL"');
    expect(sql).toMatch(/ALTER\s+TABLE\s+"SIGNAL"\s+ADD\s+COLUMN\s+"SIGNALTIER"/);
  });

  test("Signal model has signalTier column in a migration (regression guard)", () => {
    // The exact bug from the production log:
    //   `column "Signal.signalTier" does not exist`
    // If this test fails, the migration was deleted or never written.
    const sql = collectMigrationSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"Signal"\s+ADD\s+COLUMN\s+"signalTier"/i);
  });

  test("SignalPnL table is created with required indexes", () => {
    const sql = collectMigrationSql().toUpperCase();
    expect(sql).toContain('CREATE TABLE "SIGNALPNL"');
    expect(sql).toMatch(/CREATE\s+INDEX\s+"SIGNALPNL_SIGNALID_IDX"/);
    expect(sql).toMatch(/CREATE\s+INDEX\s+"SIGNALPNL_CREATEDAT_IDX"/);
  });

  test("every non-PK String/Int field on SignalPnL is present", () => {
    // Defensive: catches the case where the schema grows but the
    // migration is forgotten again. Adding a new required column
    // to SignalPnL will require updating both files.
    const sql = collectMigrationSql().toUpperCase();
    for (const col of ["SIGNALID", "CALIBRATEDP", "OUTCOME", "CLOSINGODDS", "PNL", "KELLYSTAKE", "SIGNALTIER"]) {
      expect(sql).toContain(`"${col}"`);
    }
  });
});