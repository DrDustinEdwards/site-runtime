---
"@dustinedwards/site-runtime": minor
---

Less filler in the pages the runtime renders (Dustin, 2026-11-18: let the layout explain). The owner page loses the sentences under "Your grants" and "Agent keys" and the longer empty-state lines ("No grants.", "No agent keys.", "No tool-call log."); the consent page loses "Next you sign in with Cloudflare Access." and the maintenance page's second sentence. Errors, the revoke instructions for keys, the local-redirect warning and the consent's provenance lines stay.

- Breaking: `loginHandler`'s `admits` is `{ refusal }`; `consent` is gone (it only fed the removed line).
- Breaking: `text` is optional in `SIGN_IN_LINK_WORDS` and `emailLinkWords`: the "signed-in", "confirm", "changed" and "verified" words are a title only. A page that shows `words.text` shows nothing there.
- The "used" sign-in link's text is shorter: "A sign-in link works once. Send yourself a new one."
