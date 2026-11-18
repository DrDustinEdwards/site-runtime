---
"@dustinedwards/site-runtime": patch
---

`recordAiOutcome` ignores an `aborted` result, so a reader who leaves a streamed answer early no longer turns the `ai-<feature>` health check to warn.
