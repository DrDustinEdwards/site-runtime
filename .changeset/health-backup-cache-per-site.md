---
"@dustinedwards/site-runtime": patch
---

/health keeps its backup read in the data center cache under a key that includes the deployed commit. Workers on one zone or workers.dev account shared one key, so bsw reported txasm's backup. Without a `sha` the backup is read every time.
