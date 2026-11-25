---
"@dustinedwards/site-runtime": patch
---

`sentry.mjs` is the Sentry 10 code again (`sendDefaultPii: false` and `wrapRequestHandler`), matching the 10.78.0 SDK 0.182.1 returned to. 0.182.1 kept the Sentry 11 options, which 10.78.0 does not read.
