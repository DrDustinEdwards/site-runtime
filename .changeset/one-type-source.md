---
"@dustinedwards/site-runtime": minor
---

The JSDoc in each module is now the one type source. The 115 hand-written `.d.mts` files are gone; the release builds
`dist/*.d.mts` from the JSDoc and every export's `types` points there. No module's API changes.
