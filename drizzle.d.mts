import type { SQLiteColumn, SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";

/** One column as drizzle infers it from `text(name)` or `integer(name)` with its modifiers. */
type Column<
  Table extends string,
  Name extends string,
  Kind extends "text" | "integer",
  NotNull extends boolean = false,
  Extra extends { hasDefault?: boolean; isPrimaryKey?: boolean } = {},
> = SQLiteColumn<
  {
    name: Name;
    tableName: Table;
    dataType: Kind extends "text" ? "string" : "number";
    columnType: Kind extends "text" ? "SQLiteText" : "SQLiteInteger";
    data: Kind extends "text" ? string : number;
    driverParam: Kind extends "text" ? string : number;
    notNull: NotNull;
    hasDefault: Extra["hasDefault"] extends true ? true : false;
    isPrimaryKey: Extra["isPrimaryKey"] extends true ? true : false;
    isAutoincrement: false;
    hasRuntimeDefault: false;
    enumValues: Kind extends "text" ? [string, ...string[]] : undefined;
    baseColumn: never;
    identity: undefined;
    generated: undefined;
  },
  {},
  Kind extends "text" ? { length: number } : {}
>;

type Table<Name extends string, Columns> = SQLiteTableWithColumns<{
  name: Name;
  schema: undefined;
  columns: Columns;
  dialect: "sqlite";
}>;

/** ./cron CRON_SQL: each scheduled job's last start, success and failure (epoch ms). */
export const cronRuns: Table<
  "cron_runs",
  {
    name: Column<"cron_runs", "name", "text", true, { isPrimaryKey: true }>;
    everyMinutes: Column<"cron_runs", "every_minutes", "integer", true>;
    firstStartedAt: Column<"cron_runs", "first_started_at", "integer">;
    lastStartedAt: Column<"cron_runs", "last_started_at", "integer">;
    lastOkAt: Column<"cron_runs", "last_ok_at", "integer">;
    lastFailedAt: Column<"cron_runs", "last_failed_at", "integer">;
    lastError: Column<"cron_runs", "last_error", "text">;
  }
>;

/** ./cron CRON_LOG_SQL: one row per recorded run (epoch ms), its outcome ("ok", "refused", "failed") and reason. */
export const cronRunLog: Table<
  "cron_run_log",
  {
    id: Column<"cron_run_log", "id", "integer", true, { isPrimaryKey: true; hasDefault: true }>;
    name: Column<"cron_run_log", "name", "text", true>;
    startedAt: Column<"cron_run_log", "started_at", "integer", true>;
    finishedAt: Column<"cron_run_log", "finished_at", "integer", true>;
    outcome: Column<"cron_run_log", "outcome", "text", true>;
    reason: Column<"cron_run_log", "reason", "text", true, { hasDefault: true }>;
  }
>;

/** ./not-found NOT_FOUND_SQL: the 404 count per day (epoch ms), path and referring host. */
export const page404Daily: Table<
  "page_404_daily",
  {
    id: Column<"page_404_daily", "id", "text", true, { isPrimaryKey: true }>;
    day: Column<"page_404_daily", "day", "integer", true>;
    path: Column<"page_404_daily", "path", "text", true>;
    referrerHost: Column<"page_404_daily", "referrer_host", "text", true, { hasDefault: true }>;
    kind: Column<"page_404_daily", "kind", "text", true, { hasDefault: true }>;
    hitCount: Column<"page_404_daily", "hit_count", "integer", true, { hasDefault: true }>;
  }
>;

/** ./cron-alert ALERTS_SQL: one row per alert sent (day YYYY-MM-DD UTC, created_at epoch ms). */
export const alertsSent: Table<
  "alerts_sent",
  {
    key: Column<"alerts_sent", "key", "text", true>;
    kind: Column<"alerts_sent", "kind", "text", true>;
    day: Column<"alerts_sent", "day", "text", true>;
    detail: Column<"alerts_sent", "detail", "text">;
    createdAt: Column<"alerts_sent", "created_at", "integer", true>;
  }
>;

/** ./sign-in-account AUTH_EVENTS_SQL with AUTH_EVENTS_DEVICE_SQL: the auth event log (at epoch ms). */
export const authEvents: Table<
  "auth_events",
  {
    id: Column<"auth_events", "id", "integer", true, { isPrimaryKey: true; hasDefault: true }>;
    at: Column<"auth_events", "at", "integer", true>;
    event: Column<"auth_events", "event", "text", true>;
    change: Column<"auth_events", "change", "text">;
    via: Column<"auth_events", "via", "text">;
    userId: Column<"auth_events", "user_id", "text">;
    device: Column<"auth_events", "device", "text">;
    location: Column<"auth_events", "location", "text">;
    deviceId: Column<"auth_events", "device_id", "text">;
  }
>;
