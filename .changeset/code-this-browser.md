---
"@dustinedwards/site-runtime": minor
---

The six-digit sign-in code works only in the browser that asked for it (the security review's finding 2, Dustin's yes 2026-11-18). The request that mails a code sets a signed `code_browser` cookie, and a code typed in any other browser is refused with `CODE_OTHER_BROWSER` before it is read, so it spends none of the code's tries. A guesser must now ask for every code it tries, which needs a Turnstile pass, spends the address's five mails an hour and sends the person a mail. The emailed link still works in any browser.

Breaking for a site whose server posts the form:

- `signInFormAction` answers a sent mail with `headers`; send them with the page (`data(result.state, { status: result.status, headers: result.headers })`).
- `requestSignInLink` answers `{ status: "sent", headers }` or `{ status }`, like `signInWithCode`; `LinkResult` is now `LinkRefusal`.
- `CodeRefusal` has `"other-browser"`, with its words in `SIGN_IN_WORDS.code`.
  A site whose browser calls Better Auth itself (Foxing's web page and app) needs no change.
