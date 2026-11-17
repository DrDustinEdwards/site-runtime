---
"@dustinedwards/site-runtime": patch
---

withRequestLog's 5xx `request` line is no longer a Sentry report: what failed is reported where it failed, and an intended 501 or 503 is not a fault. `logEvent` takes `report: false` to keep an error line out of the reports.
