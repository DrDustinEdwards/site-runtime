---
"@dustinedwards/site-runtime": patch
---

R2's transient errors (10001, 10043) are matched with D1's by `isDatabaseDown`, so the one retry (after 300 ms) and the 503 share one test. A `server_error` line for D1 or R2 being down for a moment is a warning, not an error, so Sentry does not report it. A "fail" health check that timed out or threw logs the warning `health_check_unavailable`; one that measured a failure is still an error.
