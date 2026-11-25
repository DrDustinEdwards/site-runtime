---
"@dustinedwards/site-runtime": patch
---

Declared return types are back where 0.182.0 let them become inferred: `defineImages` returns `Images<U>` again (so `attributes().sources` keeps `media?`), `healthTile` and `readHealthTile` return `HealthTile`, and `accessAllowed`, `accessDrift`, `corpFor`, `entryOverrides`, `healthChecks`, `healthOf`, `parseHealth`, `keysAtAddresses`, `pageSecurity`, `snapshotFromBody` and `drawShareCard` have their `@returns`. `AddressOptions` is exported from `./image` again, and `redeemConfirm`'s `expect` is optional again.
