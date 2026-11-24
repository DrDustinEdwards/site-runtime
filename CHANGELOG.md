# @dustinedwards/site-runtime

## 0.181.2

### Patch Changes

- A cron job whose error carries a database outage as its cause (site-api's "schedule(s) failed") no longer fails the scheduled invocation: runJobs read the stored text, which had lost the cause.

## 0.181.1

### Patch Changes

- Publishes `sign-in-prune.mjs`, which 0.181.0's `./sign-in` imports but left out of the package, so installs of 0.181.0 fail to build.

## 0.181.0

### Minor Changes

- `pruneExpiredAuth` also deletes Better Auth's sign-in rate-limit rows a day after their last request, on sites that have the table. txasm's own job for it goes.

## 0.180.0

### Minor Changes

- `./sign-in-client` exports `signInAgainIfStale(error, signInHref)`, the browser step Foxing and Foxhound each wrote: on Better Auth's SESSION_NOT_FRESH it sends the person to sign in again and back to the page.

## 0.179.0

### Minor Changes

- Removes `./ai-gateway` (`anthropicRoute`): no site or package calls it, and `./anthropic` has always called Anthropic directly. The 1.7.12 comments on Better Auth's behavior now name 1.7.25, which the dist and a run confirm.

## 0.178.0

### Minor Changes

- Fixes from the 2026-11-23 code review. `parseMoneyInput` accepts a comma only as a thousands group, so "12,50" is no longer read as 1250.00. `startSocialSignIn` goes through Better Auth's handler, so its per-address limiter counts a social start; it takes the handler's `auth`, not `auth.api`. `fireOnce` takes over a stale record with a compare-and-set, so a custom store needs `replace(key, expected, value)` beside `add` (`d1FireStore` has it). `/register` reads at most 8 KiB before it counts, the CSP report sinks key their limiter on `clientIp`, a modified click no longer waits for the app in `hydrateOnIntent`, a renewal grants no permission the actor lacks, a truncated private key in a tool argument no longer throws in the call log, and a provider id in a failed sign-in is logged only when it is one of ours.

## 0.177.0

### Minor Changes

- `siteHealthResponse`'s `jobs` may be a function (sync or async), for a site whose registered cron jobs depend on its database, such as jobs its settings switch off. Foxhound's /health had its own copy of the D1 ping, the deployed commit and the cron check for that.

## 0.176.3

### Patch Changes

- `render-html.mjs` is in the package's `files`, so `./render-html` resolves in an installed copy.

## 0.176.2

### Patch Changes

- A consumer's inferred types compile again: `doc-room` names `RoomViewer` and `ServerMessage` through its entry, and `./sign-in-link` and `./sign-in-account` are entries so their types can be named.

## 0.176.1

### Patch Changes

- Make the /health response smaller: the backup warning and the optional fields are read and left out in fewer lines, with the same JSON body.

## 0.176.0

### Minor Changes

- `renderHtml(site, request, env)` is its own module, `./render-html`, not a method on the site (0.174.0 added `site.renderHtml`, which every Worker carried whether it called it or not). Nothing used the method yet.

## 0.175.0

### Minor Changes

- The JSDoc in each module is now the one type source. The 115 hand-written `.d.mts` files are gone; the release builds
  `dist/*.d.mts` from the JSDoc and every export's `types` points there. No module's API changes.

## 0.174.0

### Minor Changes

- `site.renderHtml(request, env)` renders a page's HTML through the site's own handler with no request context, for a cron job that reads its own pages (germomics and txasm's page-dates job each had this copy).
- ./health adds `siteHealthResponse(env, { backup, checks, jobs })`: healthResponse with the D1 ping, the deployed commit and the cron check that every site with a database repeated.

## 0.173.13

### Patch Changes

- Shrink the merged-purge code (the Worker bundle is about 0.04 KiB smaller), so sites near their size budget fit 0.173.12.

## 0.173.12

### Patch Changes

- `purgePages` merges purges asked within 250 ms into one request with every tag, so a write that purges several times, or several writes close together, no longer empty the account's purge bucket (Free: 5 requests a minute, the limit Workers Caching always uses). Exports `purgeCoalesced`.

## 0.173.11

### Patch Changes

- Smaller Worker code: `stampValidator` copies the response with `new Response(body, response)` and tags the page with the full SHA-256 (43 characters), and `isDatabaseDown` matches the D1, Durable Object and R2 messages with shorter patterns.

## 0.173.10

### Patch Changes

- R2's transient errors (10001, 10043) are matched with D1's by `isDatabaseDown`, so the one retry (after 300 ms) and the 503 share one test. A `server_error` line for D1 or R2 being down for a moment is a warning, not an error, so Sentry does not report it. A "fail" health check that timed out or threw logs the warning `health_check_unavailable`; one that measured a failure is still an error.
  The waits in the R2 retry, the purge retry and the Anthropic retry use `scheduler.wait` (Workers) instead of a `setTimeout` promise, which takes less code.

## 0.173.9

### Patch Changes

- A "fail" health check that timed out or hit D1 being down is logged as the warning `health_check_unavailable`, not the error `health_check_failed` that Sentry reports (Foxing's db check timed out after 3000 ms five times in five days). `/health` still answers 503, and a check that threw any other error is still an error.
- Trim the R2 retry (one cause walk for D1 and R2 errors, one log call) so a Worker close to its size budget takes it without going over.

## 0.173.8

### Patch Changes

- An R2 read that fails with R2's transient error (10001 or 10043) is asked again after 200 ms and 600 ms (`retryR2Read` in `./r2-object`, used by `r2ObjectResponse` and `./image`'s `serve`). A request that still fails on it is one `storage_unavailable` warning and answers 503 with `Retry-After` (`databaseDownStatus` now covers R2 as well as D1), not a `server_error` that Sentry reports.

## 0.173.7

### Patch Changes

- Trim `stampValidator` (the body ETag of a shared page) so a Worker close to its size budget takes 0.173.6 without going over.

## 0.173.6

### Patch Changes

- Give a shared page a weak ETag from its body, so every stored copy and every render of it agree and a returning reader gets 304 whichever copy answers. Render-time Last-Modified differed per copy and after each purge.

## 0.173.5

### Patch Changes

- Match React Router's cross-origin action refusal by its closing sentence alone, which every Worker that bundles `./log` carries about 150 bytes lighter.

## 0.173.4

### Patch Changes

- A cache purge Cloudflare refuses for its rate (code 1134, a burst of publishes) is asked again after a pause, up to four times, so pages do not stay stale and /health does not warn. React Router's refusal of a cross-origin action (a wrong or forged `origin` header) is one `action_refused` warn line, not a `server_error` report.

## 0.173.3

### Patch Changes

- The registry marks julieedwards.info's root `/site-<hash>.js` as immutable for a year, as it does for the other sites, so the speed check's C1 passes there.

## 0.173.2

### Patch Changes

- The registry marks devkit siteScript's root `/site-<hash>.js` as immutable for a year, as it does `/assets/*` and `/islands/*`, and the speed check's missing 103 Early Hints is a warning on a workers.dev address, which can never send one.

## 0.173.1

### Patch Changes

- `site-runtime-speed` no longer ends with an unhandled HTTP/2 "Protocol error" after its Early Hints probe. It drops the probe's connection with `destroy` instead of a graceful `close`, so the check finishes and reports its findings.

## 0.173.0

### Minor Changes

- Integrity-Policy is enforced on the Capsomer site, the Capsid Portal and Desk, whose builds give every script an integrity; only bsw stays Report-Only (its Web Analytics beacon cannot carry one), with Foxhound, Foxing and txasm, whose Turnstile script cannot either.

### Patch Changes

- `./sri` finds an `import()` whose specifier is a template literal, as Vite's minifier writes it, so those chunks get their modulepreload with integrity too. Before, Capsomer's site-header-search chunk had none and Integrity-Policy would have blocked it.

## 0.172.1

### Patch Changes

- Foxhound, Foxing and txasm send Integrity-Policy Report-Only again: the enforced header blocked Cloudflare's Turnstile script, which cannot carry integrity, so their sign-in and sign-up forms could not load the widget.

## 0.172.0

### Minor Changes

- `./sri` also gives each module a page reaches through `import()` a low-priority modulepreload with its integrity, so a build with lazy chunks (Capsomer's site, the Capsid Portal) can enforce Integrity-Policy.

### Patch Changes

- sign-in check: a passkey rpId that follows a stand-in origin (--from) is a warning, not an error, until the real host serves the site.
- ai-audit treats the resources/read caching-hints check as not applicable when the list-only test key is refused with -32601.

## 0.171.0

### Minor Changes

- Integrity-Policy is enforced on dustinedwards.info, Foxhound, Foxing, Germomics, julieedwards.info and txasm, whose build gives every script an integrity; the other sites stay Report-Only.

## 0.170.0

### Minor Changes

- `./context` exports `previewContext<T>()`, the null-default context a Carrel preview's draft (a post or a page) is set on for the in-process render, which germomics, txasm and dustinedwards.info each declared by hand.

### Patch Changes

- Foxing's and txasm's registry reasons now say what the coep reports showed refused (Turnstile's frame, the PDF.js worker), so Report-Only stays on evidence.

## 0.169.4

### Patch Changes

- The Capsid Portal now sends an enforced Cross-Origin-Embedder-Policy (`credentialless`) instead of the Report-Only form: its coep reports showed no refusal.
- /health keeps its backup read in the data center cache under a key that includes the deployed commit. Workers on one zone or workers.dev account shared one key, so bsw reported txasm's backup. Without a `sha` the backup is read every time.
- `/media` returns a cache hit as a new Response, so the headers the Renderer sets on it no longer throw "Can't modify immutable headers" (Sentry DUSTINEDWARDS-C).

## 0.169.3

### Patch Changes

- D1 trouble stops reaching Sentry as a site error. `isDatabaseDown` now knows the account-wide back-off ("Your account is generating too much load on D1 DBs"), D1's "internal error; reference" and a Durable Object that restarted under a call. `runJobs` records a job that failed that way but no longer fails the whole invocation. The 404 counter keeps at most 8 writes waiting per isolate, so a scanner's burst of 404s cannot overload the site's database, and logs a database-down failure as a warning.

## 0.169.2

### Patch Changes

- `recordAiOutcome` accepts any store with `get`, `put` and `delete` whose writes resolve to anything, so a site without a KV namespace can keep the outcome in D1 through `d1FireStore` (./routine). No token or class changed.
- `readForm` answers a body whose Content-Type is not a form type with a 415 and a form body that does not parse with a 400, both thrown as Responses like the 413, so a stray POST is a refusal and no longer a reported error.

## 0.169.1

### Patch Changes

- `recordAiOutcome` ignores an `aborted` result, so a reader who leaves a streamed answer early no longer turns the `ai-<feature>` health check to warn.

## 0.169.0

### Minor Changes

- `SIGN_IN_PATH` and `CONFIRM_PATH` are in their own module, `./sign-in-path`, with no Better Auth import, so a page or link can name them without adding the sign-in client to its bundle (Foxing's `diary-new` route grew 4.7 KB gzip when it imported them from `./sign-in-client`). `./sign-in-client` no longer re-exports them (new in 0.168.0, so no one else uses that); `./sign-in` still does.

## 0.168.0

### Minor Changes

- `./health` gains `recordAiOutcome(kv, feature, result)` and `aiOutcomeCheck(feature, kv)`: the `ai-<feature>` warn check shows an AI feature whose last real call failed (a spend cap, a revoked key, a removed model) until a call succeeds or a day passes, while `aiCheck` still only proves the binding. It runs no model.
- `SIGN_IN_PATH` ("/login", with `CONFIRM_PATH` in the browser module, exported from `./sign-in` and, for browser code, `./sign-in-client`) is where every site's sign-in page lives. The daily live sign-in check now probes only that path (it tried `/login`, `/signin` and `/sign-in`) and the confirm page beside it or at `CONFIRM_PATH`.

## 0.167.0

### Minor Changes

- Less filler in the pages the runtime renders (Dustin, 2026-11-18: let the layout explain). The owner page loses the sentences under "Your grants" and "Agent keys" and the longer empty-state lines ("No grants.", "No agent keys.", "No tool-call log."); the consent page loses "Next you sign in with Cloudflare Access." and the maintenance page's second sentence. Errors, the revoke instructions for keys, the local-redirect warning and the consent's provenance lines stay.
  - Breaking: `loginHandler`'s `admits` is `{ refusal }`; `consent` is gone (it only fed the removed line).
  - Breaking: `text` is optional in `SIGN_IN_LINK_WORDS` and `emailLinkWords`: the "signed-in", "confirm", "changed" and "verified" words are a title only. A page that shows `words.text` shows nothing there.
  - The "used" sign-in link's text is shorter: "A sign-in link works once. Send yourself a new one."

## 0.166.0

### Minor Changes

- `./doc-room`: the suggest gate (`suggestOnly`) now refuses a suggester's change to anyone else's suggestions, not only one that makes them more. Before, a hand-built update could reword another person's pending insertion at the same length, and that person could then accept words they never wrote.
  - Breaking: the room's `DocModel` takes `suggestions(json)`, each person's suggested content by id (compared as JSON), in place of `suggestionCounts(json)`. Pass Capsomer collab-editor's per-person suggestions (insertions and deletions with their text) once it exports them.

## 0.165.0

### Minor Changes

- The six-digit sign-in code works only in the browser that asked for it (the security review's finding 2, Dustin's yes 2026-11-18). The request that mails a code sets a signed `code_browser` cookie, and a code typed in any other browser is refused with `CODE_OTHER_BROWSER` before it is read, so it spends none of the code's tries. A guesser must now ask for every code it tries, which needs a Turnstile pass, spends the address's five mails an hour and sends the person a mail. The emailed link still works in any browser.
  Breaking for a site whose server posts the form:
  - `signInFormAction` answers a sent mail with `headers`; send them with the page (`data(result.state, { status: result.status, headers: result.headers })`).
  - `requestSignInLink` answers `{ status: "sent", headers }` or `{ status }`, like `signInWithCode`; `LinkResult` is now `LinkRefusal`.
  - `CodeRefusal` has `"other-browser"`, with its words in `SIGN_IN_WORDS.code`.
    A site whose browser calls Better Auth itself (Foxing's web page and app) needs no change.
- Four small sign-in fixes from the security review.
  - An `AGENT_KEY_*` secret under 32 characters is no longer a key, as for `MCP_PROBE_KEY` and the operator token.
  - The owner page asks `admit` and `readsLog` on every request, so an admin taken off ADMIN_EMAIL or CO_OWNER_EMAILS loses it at once instead of after up to 30 minutes.
  - `remoteKeys` (the MCP sign-in's Access keys) refetches after an hour, like `./access`. `KEYS_MAX_AGE_MS` now lives in `./access-login` (moved from `./access`).
  - Breaking: `registrationLimited(request, kv, configured, now?)` takes the registration allowlist. Every registration still counts toward five an hour per address, but only an allowed one counts toward the thirty a day, so junk cannot close registration for everyone. Pass the same allowlist the provider's callback checks.

### Patch Changes

- A failed sign-in counts against an address only when the request proved something about it. A Google or Apple ID token that does not check out no longer counts against the address it names, and a wrong six-digit code counts against the address only while a code for it is live. Before this, anyone could lock a known person out of passkey, Google, Apple and code sign-in by naming them. Unproven failures are held by the per-IP limit.

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
