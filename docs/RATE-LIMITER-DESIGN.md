# One rate limiter: design (job_3ef2123d7ec6, D7.1)

Status: DESIGN ONLY. Nothing is built. The job says to stop for the seat here and build after approval. The decisions the seat has to make are at the end.

Dustin's D7: one shared limiter; each site sets its own limits and whether it fails open or closed; a dropped request answers 429, never a success code; limits come from the worst legitimate burst.

## What exists (read from each repo's default branch, 2026-10-06)

| Site | Storage | Window | Atomic | Failure mode | Retry-After |
| --- | --- | --- | --- | --- | --- |
| dustinedwards-info `limitHit` over `AskBudget` | Durable Object, SQLite | fixed, one row, over-limit hits write nothing | yes | caller sees `"unavailable"` and refuses | none |
| foxhound `RATE_LIMITER` DO | Durable Object, key-value | fixed, one record | yes | fail OPEN everywhere (`catch`, `console.error`, allow) | accurate, from the window |
| capsid `checkRate` | KV | two fixed windows (hour, day) | no | per policy, `onUnavailable: allow or refuse` | full window length, not time left |
| germomics `enforceRateLimit` | KV | fixed 60 s (the comment says sliding) | no | no handler: a KV or settings throw becomes a 500, so closed by accident | constant 60 |
| foxing `rateLimit(cls)` | Workers Rate Limiting binding | opaque, per location | no | skipped silently when the binding is unbound; a throw is a 500 | none |

Cloudflare says of the binding: "The Rate Limiting API is permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system", its period "Must be either `10` or `60`", and "For each unique key you pass to your rate limiting binding, there is a unique limit per Cloudflare location." foxhound already replaced it after tail logs showed `success: true` past every limit.

## The best of each, kept

- dustinedwards-info: a Durable Object, exact counting in synchronous SQL (no `await` in the body, so no race), and a drop does not write.
- foxhound: an accurate `Retry-After` from the window's end, and the path matcher that mirrors the router's path decoding so `/LOGIN`, `/login///` and `/%4COGIN` cannot slip past a rule.
- capsid: a typed verdict that makes a reader tell "spent" from "unmeasured", and the failure mode chosen beside the endpoint, per call.
- germomics: limits tunable at runtime (it reads them from its settings table). Kept as the caller's concern: the limiter takes numbers, the site decides where they come from.

## Interface

One module, no dependencies, `cloudflare:workers` imported only by the DO file.

```js
// the Durable Object class each Worker exports and binds (SQLite-backed)
export class RateLimiter extends DurableObject { hit(rules, now) }

const verdict = await limit(env.RATE_LIMITER, key, [{ limit: 300, windowSeconds: 3600 }, { limit: 1000, windowSeconds: 86400 }], {
  onUnavailable: "refuse", // or "allow": required, no default, so every call site states it
});
// verdict: { status: "ok" | "limited" | "unavailable", used, limit, retryAfterSeconds, window?, detail? }

limitedResponse(verdict) // 429 + Retry-After (time left in the window), or 503 + Retry-After 60 when unavailable and refused
```

- `key` is built by the caller with a bucket prefix (`ask:ip:1.2.3.4`), so budgets never mix. A helper builds it from the request IP and returns one shared `anon` bucket only when the header is absent, with the verdict flagged so a site can see it.
- One DO per key holds every window for that key. `hit` checks all rules first and counts none if any is spent, which is capsid's "refuse before write" for two windows, atomically (capsid's two KV keys are not).
- `onUnavailable` is REQUIRED. "allow" still returns `status: "unavailable"`, and the module logs a structured line with the key bucket and error. The call site decides whether to pass; the module never swallows the failure itself. This is what the "never swallow an error" rule asks of foxhound's current `console.error` and carry on.
- `matchRule(request, rules)` is foxhound's decoded-path matcher, exported separately for sites that guard by path (foxhound, germomics, foxing) and unused by dustinedwards-info, which guards by call.
- Idle cleanup: the DO sets an alarm at the end of its longest window and deletes its storage there, so an empty instance is released. foxhound's per-IP instances are never deleted today, and `AskBudget` keeps one row per instance forever.

Not included: the site's choice of limits, where they live (germomics' settings table stays germomics'), and the AI daily cost cap (`ask-budget`'s `consume`, germomics' `aiCostCapExceeded`), which is a budget and not a rate; it stays with each site.

## Cost: a Durable Object against KV

Cloudflare's pricing pages, fetched 2026-10-06, quoted:

- Durable Objects, Paid: requests "1 million / month, + $0.15/million"; SQLite rows read "First 25 billion / month included + $0.001 / million rows"; rows written "First 50 million / month included + $1.00 / million rows"; duration "400,000 GB-s / month, + $12.50/million GB-s". Free: requests "100,000 / day", rows written "100,000 / day", and "Only Durable Objects with SQLite storage backend are available".
- KV, Paid: reads "10 million/month, + $0.50/million"; writes "1 million/month, + $5.00/million". Free: reads "100,000 / day", writes "1,000 / day".

Per million guarded requests that are allowed (one window): a KV limiter makes one read and one write, so $0.50 + $5.00 = $5.50 beyond the included amounts (capsid's two windows make it two reads and two writes, $11.00). A DO limiter makes one request ($0.15), reads one row and writes one row (about $1.00), so about $1.15, and about $1.35 with the cleanup row. Duration is a few milliseconds per call, so I have counted it as negligible and not measured it. The DO is about four to nine times cheaper per million than the KV limiters, and exact where KV undercounts. On the Free plan the KV limiter stops working at 1,000 allowed requests a day (the write quota), while a DO allows about 100,000.

Volumes: none of the five sites states its guarded volume except capsid, whose test comment records its busiest measured day as 15 CSP reports. At that volume every option costs nothing. I have not measured the others; the formulas above are per million, so a site's cost is its monthly guarded requests times those figures, less the included amounts. A drop on a DO limiter costs a request and a row read and no write.

## Failure mode per site (proposal, the seat rules on it)

| Site | Call | `onUnavailable` | Why |
| --- | --- | --- | --- |
| dustinedwards-info | every call | refuse | what it does now ("a guard that passes silently when its counter is gone is never noticed") |
| capsid | `/csp-report` | refuse | what it does now; each accepted report is an R2 object |
| germomics | `/admin/ai*`, `/api/auth*`, `/admin*` | refuse | what it does now by accident (a 500); this makes it a stated choice and a 503 |
| foxing | auth, write, companion | refuse for auth and write; companion allow | today it skips silently when unbound; unbound in production becomes visible |
| foxhound | all | SEE QUESTION 2 | the job text says it fails closed; its code fails open |

## Tests (when built)

- Window edges: the `limit`-th hit in a window is `ok`, the `limit + 1`-th is `limited`; the first hit after the boundary is `ok` and the count restarts; two rules, one spent, counts neither.
- A limited hit writes nothing (row count unchanged).
- Fail-closed path: a throwing binding and a missing binding both give `unavailable`, and `limitedResponse` of it is a 503 under `refuse`, and the call proceeds under `allow` with the log line emitted.
- Retry-After equals the seconds left in the window, not the window length.
- Alarm cleanup empties storage after the longest window.
- Seen failing: plant an off-by-one window (`>` for `>=`, and a boundary test using `floor` against `ceil`), run, name the red tests, restore.

## Home

Reuse first, checked:

- `site-helpers` (D4.1, job_c400df0c744a, PR #374): feed, sitemap, llms.txt and FTS5 helpers, pure and Web-standard. A limiter imports the Workers runtime for its Durable Object class and is released on a different cadence. Putting it there would make a feed fix and a limiter fix one version.
- `security-headers` (D6.1, job_48d76e07e521): response headers and the CSP. Not a counter either.
- `renovate-config`: dependency rules.

Recommendation: a new public repo `rate-limit`, installed by tag as the other two will be. It is an account step, so building it blocks with the exact `gh repo create` command, as D4.1 and D6.1 did.

## Adoption order (after the package is tagged)

dustinedwards-info, capsid, germomics, foxing, foxhound last, each its own job and PR. dustinedwards-info first is a rename: `limitHit` becomes `limit` with an explicit `onUnavailable`, and the `AskBudget` class's `hit` moves into the shared class; `consume` (the daily Ask budget) stays.

## Decisions for the seat

1. Home: a new public repo `rate-limit` (recommended), or put it in `site-helpers`.
2. foxhound: the job says it keeps failing closed by its own setting. Its code at origin/main fails OPEN everywhere, with the comment that a DO hiccup must not lock out sign-in. Which does foxhound want, per route? The new module makes either a stated per-call choice.
3. Retry-After: accurate time left in the window (changes capsid, which sends the whole window, and gives dustinedwards-info, foxing and none-sending germomics a header they lack).
4. foxing's auth limit is 5 per 60 seconds per IP, which is tight behind a shared NAT; the move to an exact limiter makes it stricter than the permissive binding is today, so its numbers need a look before adoption.
