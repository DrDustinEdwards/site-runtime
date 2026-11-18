---
"@dustinedwards/site-runtime": patch
---

`readForm` answers a body whose Content-Type is not a form type with a 415 and a form body that does not parse with a 400, both thrown as Responses like the 413, so a stray POST is a refusal and no longer a reported error.
