// Each Drizzle mirror (drizzle.mjs) against the SQL that creates its table: columns, types, NOT NULL, defaults,
// the primary key and the indexes, so a change to one SQL without its mirror fails here, not in a site's migration.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { getTableConfig } from "drizzle-orm/sqlite-core";

import { ALERTS_SQL } from "../cron-alert.mjs";
import { CRON_SQL } from "../cron.mjs";
import { alertsSent, authEvents, cronRuns, page404Daily } from "../drizzle.mjs";
import { NOT_FOUND_SQL } from "../not-found.mjs";
import { AUTH_EVENTS_DEVICE_SQL, AUTH_EVENTS_SQL } from "../sign-in-account.mjs";

/** The table as SQLite holds it after the SQL runs. */
function fromSql(sql, name) {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  const columns = db
    .prepare(`PRAGMA table_info(${name})`)
    .all()
    .map((c) => ({
      name: c.name,
      type: c.type,
      notNull: Boolean(c.notnull) || c.pk > 0,
      default: c.dflt_value,
      pk: c.pk,
    }));
  const indexes = db
    .prepare(`PRAGMA index_list(${name})`)
    .all()
    .filter((i) => i.origin === "c")
    .map((i) => ({
      name: i.name,
      unique: Boolean(i.unique),
      on: db
        .prepare(`PRAGMA index_info(${i.name})`)
        .all()
        .map((c) => c.name),
    }));
  const autoincrement = /AUTOINCREMENT/i.test(sql);
  return { columns, indexes, autoincrement };
}

/** The same, read off the Drizzle table. */
function fromDrizzle(table) {
  const config = getTableConfig(table);
  const composite = config.primaryKeys[0]?.columns.map((c) => c.name) ?? [];
  const columns = config.columns.map((c) => ({
    name: c.name,
    type: c.getSQLType().toUpperCase(),
    notNull: c.notNull,
    default:
      c.default === undefined
        ? null
        : typeof c.default === "string"
          ? `'${c.default}'`
          : String(c.default),
    pk: c.primary ? 1 : composite.indexOf(c.name) + 1,
  }));
  const indexes = config.indexes.map((i) => ({
    name: i.config.name,
    unique: i.config.unique,
    on: i.config.columns.map((c) => c.name),
  }));
  const autoincrement = config.columns.some((c) => c.autoIncrement);
  return { columns, indexes, autoincrement };
}

for (const [table, sql, name] of [
  [cronRuns, CRON_SQL, "cron_runs"],
  [page404Daily, NOT_FOUND_SQL, "page_404_daily"],
  [alertsSent, ALERTS_SQL, "alerts_sent"],
  [authEvents, AUTH_EVENTS_SQL + AUTH_EVENTS_DEVICE_SQL, "auth_events"],
]) {
  test(`the ${name} mirror matches its SQL`, () => {
    const byName = (/** @type {{ name: string }} */ a, /** @type {{ name: string }} */ b) =>
      a.name.localeCompare(b.name);
    const drizzle = fromDrizzle(table);
    const real = fromSql(sql, name);
    assert.deepEqual(
      { ...drizzle, indexes: drizzle.indexes.sort(byName) },
      { ...real, indexes: real.indexes.sort(byName) },
    );
  });
}
