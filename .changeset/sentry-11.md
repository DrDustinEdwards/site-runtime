---
"@dustinedwards/site-runtime": minor
---

Sentry 11. The reports carry the same fields as before: `sendDefaultPii` is gone from the SDK, so `dataCollection` turns off user info, cookies, headers, bodies and query strings, and `traceLifecycle: "static"` keeps the transaction scrub running. The Renderer's per-request wrap goes through `withSentry`, since the SDK no longer exports `wrapRequestHandler`.
