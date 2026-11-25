---
"@dustinedwards/site-runtime": patch
---

The tool-call log indexes its rows by call id, so the health check's orphan count no longer times out on a large log.
