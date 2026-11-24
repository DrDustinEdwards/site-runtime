---
"@dustinedwards/site-runtime": patch
---

A cron job whose error carries a database outage as its cause (site-api's "schedule(s) failed") no longer fails the scheduled invocation: runJobs read the stored text, which had lost the cause.
