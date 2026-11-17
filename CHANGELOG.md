# @dustinedwards/site-runtime

## 0.164.1

### Patch Changes

- `googleFont` fetches TTF, not WOFF. Takumi, which draws the share cards since 0.164.0, rejects the WOFF Google serves to an old Internet Explorer User-Agent ("Unsupported font format"); the "Mozilla/4.0" User-Agent gets one TTF with every glyph. The cached copy is keyed `<family>-<weight>.ttf`, so a WOFF kept under the old `.font` key is never read.

## 0.164.0

### Minor Changes

- Share cards no longer use workers-og. workers-og pins satori 0.15.2 and bundles its own copy, which carries GHSA-wx4j-mvgx-mqwp (fixed in satori 0.33.5), so a lockfile bump changed nothing, and satori 0.33.5 and later cannot run on Workers (their harfbuzz WASM is compiled from bytes, which Workers refuse). `./share-card-draw` now exports `drawShareCard`, Takumi's WebAssembly renderer (takumi-js 2.20.0), which reads the card's HTML itself. `renderShareCard` and `shareCardResponse` take it as their first argument in place of workers-og's `ImageResponse` class: a site imports `drawShareCard` from `@dustinedwards/site-runtime/share-card-draw`, passes it, and drops workers-og from its dependencies. Needs a bundler that compiles a `.wasm` import (wrangler and the Cloudflare Vite plugin do). Takumi decodes entities, so "&amp;" in card text now draws as "&".

## 0.163.1

### Patch Changes

- handleServerError no longer logs or reports a route error response under 500. React Router's 405 for a POST to a route with no action (a scanner's POST /index.php) was an error line and a Sentry report.

## 0.163.0

### Minor Changes

- A suppressed recipient is a known state, not a fault. `./email` exports `RECIPIENT_SUPPRESSED`, `EmailNotSent` (what a
  site's sender throws, with the code and none of the provider's words) and `isRecipientSuppressed`, and logs
  `email_send_failed` for a suppressed address as a warning. `./sign-in` answers a sign-in link or app code for a
  suppressed address with 422 `UNDELIVERABLE_EMAIL`, `requestSignInLink` returns `"undeliverable"` with
  `SIGN_IN_WORDS.link.undeliverable`, the account page's email change says `ACCOUNT_WORDS.emailUndeliverable`, and a
  security notice to a suppressed address is the warning `security_notice_undeliverable` instead of the error
  `security_notice_failed`.

### Patch Changes

- `./health`: an alert check (`alert: true`, such as `authSpikeCheck`) that throws or times out no longer raises `health_alert` or carries `alert: true`, since it measured nothing. It reports its level with the detail `could not run: ...` and logs the warning `health_check_unavailable`. On foxing.app a D1 stall timed the auth-spike check out and paged a person (FOXING-3) while the db check already reported the outage. A check that runs and measures a spike still alerts as before.
- `isDatabaseDown` also reads D1's "Currently processing a long-running import." as the database down for a moment, so `databaseDown` answers 503 for it. It now lives in `./log` and `./health` re-exports it. A cron record write or job that fails because D1 is down logs `cron_run_write_failed` or `cron_job_failed` at warn instead of error, so it is no longer a Sentry report. The run is still recorded as failed, and a database that stays down still fails the cron and database health checks.
  New in `./log`: `databaseDownStatus(request, status, headers)`. It gives a React Router answer whose route failed on a database-down error (as `handleServerError` saw it) a 503 with `Retry-After: 60` and `no-store` instead of 500. `./worker`'s render applies it to every answer, a page, a `.data` request and a resource route alike (React Router turns a resource route's thrown error into a plain-text 500 with no hook after it), so a site on `siteWorker` changes nothing; a site with its own Worker applies it to its request handler's answer (README, "The database down").

## 0.162.0

### Minor Changes

- `./doc-room`: `replace` takes `doc`, the editor's JSON with its pending suggestions, in place of the Markdown read, and `threads`, the comment threads that came with it, each anchored with the model's new optional `anchor` (Capsomer collab-editor's `anchorAt`) and stored through the app's comment store. For bringing a Google Doc into a Carrel book file (the Docs plan, slice 8). The room's new `json()` gives its working copy as the editor's JSON text, suggestions and all, for sending it back.

## 0.161.1

### Patch Changes

- withRequestLog's 5xx `request` line is no longer a Sentry report: what failed is reported where it failed, and an intended 501 or 503 is not a fault. `logEvent` takes `report: false` to keep an error line out of the reports.

## 0.161.0

### Minor Changes

- Error reports to Sentry, one project per site, on when the Worker has a `SENTRY_DSN` secret. New `./sentry` (`sentryOptions`, `withSiteSentry`, `withSentryRequest`), moved from Foxhound's own setup: errors only (`tracesSampleRate` 0), every report scrubbed as a log line is (emails, queries, keys, Drizzle params, token routes; headers, cookies, body and user dropped). `siteWorker` wraps itself with it and the Renderer runs each fetch under its own client, and `siteWorker(site, handlers)` takes a site's `queue`, `scheduled` or `email` so they are wrapped too. Every `logEvent` line at level `"error"` is also one report once ./sentry is loaded (./log's new `reportErrorLines`; ./log never loads the SDK). Adds the `@sentry/cloudflare` dependency; a Worker that uses ./worker or ./sentry without `nodejs_compat` needs the `nodejs_als` compatibility flag.

## 0.160.0

### Minor Changes

- `scriptJson` (JSON safe inside a `<script>`: no `<`, `>` or `&`, and U+2028 and U+2029 escaped) moves from `./deferred-scripts` to `./html`, which needs no React, so a site or Prelum can use the one copy. It is no longer exported from `./deferred-scripts`; import it from `@dustinedwards/site-runtime/html`.

## 0.159.0

### Minor Changes

- `staticSite` sends `X-Robots-Tag: noindex` on its 404 page and every other error response, as the rendered sites' 404s already say in their robots meta (the Prelum specimen's 404 had neither).

## 0.158.0

### Minor Changes

- CSP: connect-src names only what each site reaches. Capsomer drops raw.githubusercontent.com's results.json (nothing reads it since the docs-site rebuild) and Enarratio drops cloudflareinsights.com (its beacon is the automatic one, which reports to the gallery's own /cdn-cgi/rum); both are `connect-src 'self'` now. buildContentSecurityPolicy refuses cloudflareinsights.com in `sources.connect`: the builder adds it for `cloudflareWebAnalytics: "manual"`, and the automatic beacon does not need it.

## 0.157.0

### Minor Changes

- `MODEL_IDS.standard` is now `claude-sonnet-5-5` (was `claude-sonnet-5`): same $2 input and $10 output per MTok, cache reads half the price ($0.10). `MODELS` gains `claude-sonnet-5-5` (active, not retired before 2027-09-28, 512-token cache minimum) and `PRICES` its row, both checked against Anthropic's deprecations, prompt-caching and pricing pages on 2026-11-13.
