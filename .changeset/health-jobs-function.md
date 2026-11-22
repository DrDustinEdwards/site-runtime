---
"@dustinedwards/site-runtime": minor
---

`siteHealthResponse`'s `jobs` may be a function (sync or async), for a site whose registered cron jobs depend on its database, such as jobs its settings switch off. Foxhound's /health had its own copy of the D1 ping, the deployed commit and the cron check for that.
