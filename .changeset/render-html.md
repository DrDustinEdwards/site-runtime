---
"@dustinedwards/site-runtime": minor
---

`site.renderHtml(request, env)` renders a page's HTML through the site's own handler with no request context, for a cron job that reads its own pages (germomics and txasm's page-dates job each had this copy).
