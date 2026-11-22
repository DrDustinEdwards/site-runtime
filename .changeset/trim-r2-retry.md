---
"@dustinedwards/site-runtime": patch
---

Trim the R2 retry (one cause walk for D1 and R2 errors, one log call) so a Worker close to its size budget takes it without going over.
