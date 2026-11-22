---
"@dustinedwards/site-runtime": patch
---

A "fail" health check that timed out or hit D1 being down is logged as the warning `health_check_unavailable`, not the error `health_check_failed` that Sentry reports (Foxing's db check timed out after 3000 ms five times in five days). `/health` still answers 503, and a check that threw any other error is still an error.
