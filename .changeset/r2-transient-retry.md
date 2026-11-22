---
"@dustinedwards/site-runtime": patch
---

An R2 read that fails with R2's transient error (10001 or 10043) is asked again after 200 ms and 600 ms (`retryR2Read` in `./r2-object`, used by `r2ObjectResponse` and `./image`'s `serve`). A request that still fails on it is one `storage_unavailable` warning and answers 503 with `Retry-After` (`databaseDownStatus` now covers R2 as well as D1), not a `server_error` that Sentry reports.
