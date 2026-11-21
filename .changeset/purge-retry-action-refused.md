---
"@dustinedwards/site-runtime": patch
---

A cache purge Cloudflare refuses for its rate (code 1134, a burst of publishes) is asked again after a pause, up to four times, so pages do not stay stale and /health does not warn. React Router's refusal of a cross-origin action (a wrong or forged `origin` header) is one `action_refused` warn line, not a `server_error` report.
