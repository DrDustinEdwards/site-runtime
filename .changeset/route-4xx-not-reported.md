---
"@dustinedwards/site-runtime": patch
---

handleServerError no longer logs or reports a route error response under 500. React Router's 405 for a POST to a route with no action (a scanner's POST /index.php) was an error line and a Sentry report.
