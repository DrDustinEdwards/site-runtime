---
"@dustinedwards/site-runtime": minor
---

`SIGN_IN_PATH` and `CONFIRM_PATH` are in their own module, `./sign-in-path`, with no Better Auth import, so a page or link can name them without adding the sign-in client to its bundle (Foxing's `diary-new` route grew 4.7 KB gzip when it imported them from `./sign-in-client`). `./sign-in-client` no longer re-exports them (new in 0.168.0, so no one else uses that); `./sign-in` still does.
