// Each Drizzle mirror (drizzle.mjs) against the SQL that creates its table, through ./drizzle-check, so a change to
// one SQL without its mirror fails here, not in a site's migration.
import { test } from "node:test";

import { ALERTS_SQL } from "../cron-alert.mjs";
import { CRON_SQL } from "../cron.mjs";
import { assertMirror } from "../drizzle-check.mjs";
import { alertsSent, authEvents, cronRuns, page404Daily } from "../drizzle.mjs";
import { NOT_FOUND_SQL } from "../not-found.mjs";
import { AUTH_EVENTS_DEVICE_SQL, AUTH_EVENTS_SQL } from "../sign-in-account.mjs";

for (const [table, sql, name] of [
  [cronRuns, CRON_SQL, "cron_runs"],
  [page404Daily, NOT_FOUND_SQL, "page_404_daily"],
  [alertsSent, ALERTS_SQL, "alerts_sent"],
  [authEvents, AUTH_EVENTS_SQL + AUTH_EVENTS_DEVICE_SQL, "auth_events"],
]) {
  test(`the ${name} mirror matches its SQL`, () => assertMirror(table, sql));
}

test("a mirror that drifts from its SQL is refused", (t) => {
  t.assert.throws(
    () => assertMirror(cronRuns, CRON_SQL.replace("last_error TEXT", "last_error INTEGER")),
    {
      message: /cron_runs mirror does not match/,
    },
  );
});
