---
"@dustinedwards/site-runtime": minor
---

Fixes from the 2026-11-23 code review. `parseMoneyInput` accepts a comma only as a thousands group, so "12,50" is no longer read as 1250.00. `startSocialSignIn` goes through Better Auth's handler, so its per-address limiter counts a social start; it takes the handler's `auth`, not `auth.api`. `fireOnce` takes over a stale record with a compare-and-set, so a custom store needs `replace(key, expected, value)` beside `add` (`d1FireStore` has it). `/register` reads at most 8 KiB before it counts, the CSP report sinks key their limiter on `clientIp`, a modified click no longer waits for the app in `hydrateOnIntent`, a renewal grants no permission the actor lacks, a truncated private key in a tool argument no longer throws in the call log, and a provider id in a failed sign-in is logged only when it is one of ours.
