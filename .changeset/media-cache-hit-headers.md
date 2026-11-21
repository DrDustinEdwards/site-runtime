---
"@dustinedwards/site-runtime": patch
---

`/media` returns a cache hit as a new Response, so the headers the Renderer sets on it no longer throw "Can't modify immutable headers" (Sentry DUSTINEDWARDS-C).
