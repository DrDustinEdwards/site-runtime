# @dustinedwards/site-runtime

## 0.158.0

### Minor Changes

- CSP: connect-src names only what each site reaches. Capsomer drops raw.githubusercontent.com's results.json (nothing reads it since the docs-site rebuild) and Enarratio drops cloudflareinsights.com (its beacon is the automatic one, which reports to the gallery's own /cdn-cgi/rum); both are `connect-src 'self'` now. buildContentSecurityPolicy refuses cloudflareinsights.com in `sources.connect`: the builder adds it for `cloudflareWebAnalytics: "manual"`, and the automatic beacon does not need it.

## 0.157.0

### Minor Changes

- `MODEL_IDS.standard` is now `claude-sonnet-5-5` (was `claude-sonnet-5`): same $2 input and $10 output per MTok, cache reads half the price ($0.10). `MODELS` gains `claude-sonnet-5-5` (active, not retired before 2027-09-28, 512-token cache minimum) and `PRICES` its row, both checked against Anthropic's deprecations, prompt-caching and pricing pages on 2026-11-13.
