---
"@dustinedwards/site-runtime": patch
---

`site-runtime-speed` no longer ends with an unhandled HTTP/2 "Protocol error" after its Early Hints probe. It drops the probe's connection with `destroy` instead of a graceful `close`, so the check finishes and reports its findings.
