---
"@dustinedwards/site-runtime": patch
---

Give a shared page a weak ETag from its body, so every stored copy and every render of it agree and a returning reader gets 304 whichever copy answers. Render-time Last-Modified differed per copy and after each purge.
