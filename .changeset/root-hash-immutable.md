---
"@dustinedwards/site-runtime": patch
---

The registry marks devkit siteScript's root `/site-<hash>.js` as immutable for a year, as it does `/assets/*` and `/islands/*`, and the speed check's missing 103 Early Hints is a warning on a workers.dev address, which can never send one.
