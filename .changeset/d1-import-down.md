---
"@dustinedwards/site-runtime": patch
---

`isDatabaseDown` also reads D1's "Currently processing a long-running import." as the database down for a moment, so `databaseDown` answers 503 for it. It now lives in `./log` and `./health` re-exports it. A cron record write or job that fails because D1 is down logs `cron_run_write_failed` or `cron_job_failed` at warn instead of error, so it is no longer a Sentry report. The run is still recorded as failed, and a database that stays down still fails the cron and database health checks.

New in `./log`: `databaseDownStatus(request, status, headers)`. It gives a React Router answer whose route failed on a database-down error (as `handleServerError` saw it) a 503 with `Retry-After: 60` and `no-store` instead of 500. `./worker`'s render applies it to every answer, a page, a `.data` request and a resource route alike (React Router turns a resource route's thrown error into a plain-text 500 with no hook after it), so a site on `siteWorker` changes nothing; a site with its own Worker applies it to its request handler's answer (README, "The database down").
