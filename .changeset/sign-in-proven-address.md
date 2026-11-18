---
"@dustinedwards/site-runtime": patch
---

A failed sign-in counts against an address only when the request proved something about it. A Google or Apple ID token that does not check out no longer counts against the address it names, and a wrong six-digit code counts against the address only while a code for it is live. Before this, anyone could lock a known person out of passkey, Google, Apple and code sign-in by naming them. Unproven failures are held by the per-IP limit.
