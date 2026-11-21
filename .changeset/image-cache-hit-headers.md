---
"@dustinedwards/site-runtime": patch
---

A size answered from the edge cache comes back with headers a route can set. A hit whose headers were immutable made a route that sets a header on it throw "Can't modify immutable headers" (dustinedwards.info, one report).
