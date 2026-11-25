---
"@dustinedwards/site-runtime": patch
---

`@sentry/cloudflare` is back at 10.78.0. Version 11.16.0 (in 0.182.0) added about 20 KiB raw and 8 KiB gzip to every Worker that wraps its handler, and over 240 KiB where the bundler keeps `@sentry/conventions` whole, which put Foxhound, Foxing and julieedwards.info over their size budgets. Renovate holds it below 11.
