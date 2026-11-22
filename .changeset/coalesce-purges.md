---
"@dustinedwards/site-runtime": patch
---

`purgePages` merges purges asked within 250 ms into one request with every tag, so a write that purges several times, or several writes close together, no longer empty the account's purge bucket (Free: 5 requests a minute, the limit Workers Caching always uses). Exports `purgeCoalesced`.
