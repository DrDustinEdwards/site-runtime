---
"@dustinedwards/site-runtime": patch
---

D1 trouble stops reaching Sentry as a site error. `isDatabaseDown` now knows the account-wide back-off ("Your account is generating too much load on D1 DBs"), D1's "internal error; reference" and a Durable Object that restarted under a call. `runJobs` records a job that failed that way but no longer fails the whole invocation. The 404 counter keeps at most 8 writes waiting per isolate, so a scanner's burst of 404s cannot overload the site's database, and logs a database-down failure as a warning.
