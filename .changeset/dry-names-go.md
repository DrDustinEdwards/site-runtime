---
"@dustinedwards/site-runtime": patch
---

Removed four exports no consumer imports (checked in every site's source at v0.181.2): `verifyAccessToken` (./access, a one-line wrapper of `verifyJwt`), `NOT_FOUND_TABLE` (./not-found), `MODELS_CHECKED` (./anthropic) and `PRICES_CHECKED` (./ai-engine), two date stamps nothing read.
