---
"@dustinedwards/site-runtime": minor
---

`scriptJson` (JSON safe inside a `<script>`: no `<`, `>` or `&`, and U+2028 and U+2029 escaped) moves from `./deferred-scripts` to `./html`, which needs no React, so a site or Prelum can use the one copy. It is no longer exported from `./deferred-scripts`; import it from `@dustinedwards/site-runtime/html`.
