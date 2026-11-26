---
"@dustinedwards/site-runtime": patch
---

A job with `runJobs` history on and a period under an hour trims its history about once an hour instead of after every run. The trim read every kept row each time: Foxhound's five-minute jobs, which keep 1,500 rows, read about 3,000 rows per run, about 12 million a day.
