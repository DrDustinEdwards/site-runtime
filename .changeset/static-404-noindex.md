---
"@dustinedwards/site-runtime": minor
---

`staticSite` sends `X-Robots-Tag: noindex` on its 404 page and every other error response, as the rendered sites' 404s already say in their robots meta (the Prelum specimen's 404 had neither).
