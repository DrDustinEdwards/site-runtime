---
"@dustinedwards/site-runtime": minor
---

Four small sign-in fixes from the security review.

- An `AGENT_KEY_*` secret under 32 characters is no longer a key, as for `MCP_PROBE_KEY` and the operator token.
- The owner page asks `admit` and `readsLog` on every request, so an admin taken off ADMIN_EMAIL or CO_OWNER_EMAILS loses it at once instead of after up to 30 minutes.
- `remoteKeys` (the MCP sign-in's Access keys) refetches after an hour, like `./access`. `KEYS_MAX_AGE_MS` now lives in `./access-login` (moved from `./access`).
- Breaking: `registrationLimited(request, kv, configured, now?)` takes the registration allowlist. Every registration still counts toward five an hour per address, but only an allowed one counts toward the thirty a day, so junk cannot close registration for everyone. Pass the same allowlist the provider's callback checks.
