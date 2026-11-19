---
"@dustinedwards/site-runtime": patch
---

`recordAiOutcome` accepts any store with `get`, `put` and `delete` whose writes resolve to anything, so a site without a KV namespace can keep the outcome in D1 through `d1FireStore` (./routine). No token or class changed.
