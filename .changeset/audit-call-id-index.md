---
"@dustinedwards/site-runtime": patch
---

The tool-call log indexes `call_id`, so its health check's orphan count no longer scans the whole table once per started row and times out as the log grows.
