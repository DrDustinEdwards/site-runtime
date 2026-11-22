---
"@dustinedwards/site-runtime": minor
---

`renderHtml(site, request, env)` is its own module, `./render-html`, not a method on the site (0.174.0 added `site.renderHtml`, which every Worker carried whether it called it or not). Nothing used the method yet.
