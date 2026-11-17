---
"@dustinedwards/site-runtime": minor
---

Error reports to Sentry, one project per site, on when the Worker has a `SENTRY_DSN` secret. New `./sentry` (`sentryOptions`, `withSiteSentry`, `withSentryRequest`), moved from Foxhound's own setup: errors only (`tracesSampleRate` 0), every report scrubbed as a log line is (emails, queries, keys, Drizzle params, token routes; headers, cookies, body and user dropped). `siteWorker` wraps itself with it and the Renderer runs each fetch under its own client, and `siteWorker(site, handlers)` takes a site's `queue`, `scheduled` or `email` so they are wrapped too. Every `logEvent` line at level `"error"` is also one report once ./sentry is loaded (./log's new `reportErrorLines`; ./log never loads the SDK). Adds the `@sentry/cloudflare` dependency; a Worker that uses ./worker or ./sentry without `nodejs_compat` needs the `nodejs_als` compatibility flag.
