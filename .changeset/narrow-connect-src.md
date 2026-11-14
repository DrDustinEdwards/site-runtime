---
"@dustinedwards/site-runtime": minor
---

CSP: connect-src names only what each site reaches. Capsomer drops raw.githubusercontent.com's results.json (nothing reads it since the docs-site rebuild) and Enarratio drops cloudflareinsights.com (its beacon is the automatic one, which reports to the gallery's own /cdn-cgi/rum); both are `connect-src 'self'` now. buildContentSecurityPolicy refuses cloudflareinsights.com in `sources.connect`: the builder adds it for `cloudflareWebAnalytics: "manual"`, and the automatic beacon does not need it.
