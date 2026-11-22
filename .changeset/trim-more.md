---
"@dustinedwards/site-runtime": patch
---

Smaller Worker code: `stampValidator` copies the response with `new Response(body, response)`, and `isDatabaseDown` names three D1 and Durable Object messages and the R2 codes in fewer characters.
