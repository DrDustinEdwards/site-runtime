/**
 * Holds a Drizzle mirror to the SQL that creates its table, for a package's tests (site-runtime's ./drizzle,
 * site-api's ./drizzle): the columns with their types, NOT NULL and defaults, the primary key, AUTOINCREMENT and the
 * indexes, so a change to the SQL without its mirror fails in the package's own test, never in a site's migration.
 * Node only (node:sqlite, node:assert): it never reaches a Worker bundle, which is why it is not part of ./drizzle.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { getTableConfig } from "drizzle-orm/sqlite-core";

/** @typedef {{ name: string, type: string, notNull: boolean, default: string | null, pk: number }} ColumnShape */
/** @typedef {{ name: string, unique: boolean, on: string[] }} IndexShape */
/** @typedef {{ columns: ColumnShape[], indexes: IndexShape[], autoincrement: boolean }} TableShape */

/** @param {{ name: string }} a @param {{ name: string }} b */
const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * The table as SQLite holds it after `sql` runs.
 * @param {string} sql
 * @param {string} name
 * @returns {TableShape}
 */
function fromSql(sql, name) {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  const columns = db
    .prepare(`PRAGMA table_info(${name})`)
    .all()
    .map((c) => ({
      name: String(c.name),
      type: String(c.type),
      notNull: Boolean(c.notnull) || Number(c.pk) > 0,
      default: c.dflt_value === null ? null : String(c.dflt_value),
      pk: Number(c.pk),
    }));
  const indexes = db
    .prepare(`PRAGMA index_list(${name})`)
    .all()
    .filter((i) => i.origin === "c")
    .map((i) => ({
      name: String(i.name),
      unique: Boolean(i.unique),
      on: db
        .prepare(`PRAGMA index_info(${i.name})`)
        .all()
        .map((c) => String(c.name)),
    }));
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  db.close();
  assert.ok(table, `the SQL creates no table ${name}`);
  return {
    columns,
    indexes: indexes.sort(byName),
    autoincrement: /AUTOINCREMENT/i.test(String(table.sql)),
  };
}

/**
 * A default as SQLite prints it: text quoted, a JSON column's value as its JSON text.
 * @param {unknown} value
 */
function sqlDefault(value) {
  if (value === undefined) return null;
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "object" && value !== null) return `'${JSON.stringify(value)}'`;
  return String(value);
}

/**
 * The same, read off the Drizzle table.
 * @param {import("drizzle-orm/sqlite-core").SQLiteTable} table
 * @returns {TableShape}
 */
function fromDrizzle(table) {
  const config = getTableConfig(table);
  const composite = config.primaryKeys[0]?.columns.map((c) => c.name) ?? [];
  const columns = config.columns.map((c) => ({
    name: c.name,
    type: c.getSQLType().toUpperCase(),
    notNull: c.notNull,
    default: sqlDefault(c.default),
    pk: c.primary ? 1 : composite.indexOf(c.name) + 1,
  }));
  const indexes = config.indexes.map((i) => ({
    name: String(i.config.name),
    unique: i.config.unique,
    on: i.config.columns.map((c) => /** @type {{ name: string }} */ (c).name),
  }));
  const autoincrement = config.columns.some(
    (c) => "autoIncrement" in c && Boolean(c.autoIncrement),
  );
  return { columns, indexes: indexes.sort(byName), autoincrement };
}

/**
 * Throws an AssertionError naming the difference when `table` does not match the table of its name that `sql` creates.
 * @param {import("drizzle-orm/sqlite-core").SQLiteTable} table
 * @param {string} sql
 */
export function assertMirror(table, sql) {
  const name = getTableConfig(table).name;
  assert.deepEqual(
    fromDrizzle(table),
    fromSql(sql, name),
    `the ${name} mirror does not match its SQL`,
  );
}
