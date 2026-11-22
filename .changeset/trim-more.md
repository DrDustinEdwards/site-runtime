---
"@dustinedwards/site-runtime": patch
---

Smaller Worker code: `stampValidator` copies the response with `new Response(body, response)` and tags the page with the full SHA-256 (43 characters), and `isDatabaseDown` matches the D1, Durable Object and R2 messages with shorter patterns.
