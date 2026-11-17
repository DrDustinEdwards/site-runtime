---
"@dustinedwards/site-runtime": patch
---

`./health`: an alert check (`alert: true`, such as `authSpikeCheck`) that throws or times out no longer raises `health_alert` or carries `alert: true`, since it measured nothing. It reports its level with the detail `could not run: ...` and logs the warning `health_check_unavailable`. On foxing.app a D1 stall timed the auth-spike check out and paged a person (FOXING-3) while the db check already reported the outage. A check that runs and measures a spike still alerts as before.
