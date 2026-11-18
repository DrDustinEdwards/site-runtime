---
"@dustinedwards/site-runtime": minor
---

`SIGN_IN_PATH` ("/login", exported from `./sign-in` and, for browser code, `./sign-in-client`) is where every site's sign-in page lives. The daily live sign-in check now probes only that path (it tried `/login`, `/signin` and `/sign-in`) and the confirm page beside it or at `CONFIRM_PATH`.
