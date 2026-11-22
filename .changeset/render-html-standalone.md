---
"@dustinedwards/site-runtime": minor
---

`renderHtml(site, request, env)` is a standalone export of `./worker`, not a method on the site (0.174.0 added it as `site.renderHtml`, which every Worker carried whether it called it or not). Nothing used the method yet.
