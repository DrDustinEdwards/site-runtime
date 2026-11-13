/**
 * Drizzle mirrors of the tables site-runtime creates with its own SQL, for a site whose schema drizzle-kit reads:
 * the schema re-exports these (`export { cronRuns } from "@dustinedwards/site-runtime/drizzle"`), so drizzle-kit knows
 * the table and never writes a migration that drops or reshapes it, and no site keeps a hand copy that can drift from
 * the SQL. Every time column is epoch ms, as the SQL writes it. test/drizzle.test.mjs proves each one matches its SQL
 * column for column, with its keys and indexes.
 */
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** ./cron CRON_SQL: each scheduled job's last start, success and failure, written by runJobs. */
export const cronRuns = /* @__PURE__ */ (() =>
  sqliteTable("cron_runs", {
    name: text("name").primaryKey(),
    everyMinutes: integer("every_minutes").notNull(),
    firstStartedAt: integer("first_started_at"),
    lastStartedAt: integer("last_started_at"),
    lastOkAt: integer("last_ok_at"),
    lastFailedAt: integer("last_failed_at"),
    lastError: text("last_error"),
  }))();

/** ./cron CRON_LOG_SQL: one row per recorded run, written by runJobs with `history`, newest few kept per job. */
export const cronRunLog = /* @__PURE__ */ (() =>
  sqliteTable(
    "cron_run_log",
    {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name").notNull(),
      startedAt: integer("started_at").notNull(),
      finishedAt: integer("finished_at").notNull(),
      outcome: text("outcome").notNull(),
      reason: text("reason").notNull().default(""),
    },
    (t) => [index("cron_run_log_name").on(t.name, t.id)],
  ))();

/** ./not-found NOT_FOUND_SQL: the 404 count per day, path and referring host, the pathname only. */
export const page404Daily = /* @__PURE__ */ (() =>
  sqliteTable(
    "page_404_daily",
    {
      id: text("id").primaryKey(),
      day: integer("day").notNull(),
      path: text("path").notNull(),
      referrerHost: text("referrer_host").notNull().default(""),
      kind: text("kind").notNull().default("page"),
      hitCount: integer("hit_count").notNull().default(0),
    },
    (t) => [uniqueIndex("page_404_daily_day_path_referrer_uq").on(t.day, t.path, t.referrerHost)],
  ))();

/** ./cron-alert ALERTS_SQL: one row per alert sent, which is also the once-a-day dedupe. `day` is YYYY-MM-DD UTC. */
export const alertsSent = /* @__PURE__ */ (() =>
  sqliteTable(
    "alerts_sent",
    {
      key: text("key").notNull(),
      kind: text("kind").notNull(),
      day: text("day").notNull(),
      detail: text("detail"),
      createdAt: integer("created_at").notNull(),
    },
    (t) => [primaryKey({ columns: [t.key, t.kind, t.day] })],
  ))();

/** ./sign-in-account AUTH_EVENTS_SQL with AUTH_EVENTS_DEVICE_SQL: the auth event log, never an address or a code. */
export const authEvents = /* @__PURE__ */ (() =>
  sqliteTable(
    "auth_events",
    {
      id: integer("id").primaryKey({ autoIncrement: true }),
      at: integer("at").notNull(),
      event: text("event").notNull(),
      change: text("change"),
      via: text("via"),
      userId: text("user_id"),
      device: text("device"),
      location: text("location"),
      deviceId: text("device_id"),
    },
    (t) => [
      index("auth_events_user").on(t.userId, t.at),
      index("auth_events_at").on(t.at, t.event),
    ],
  ))();
