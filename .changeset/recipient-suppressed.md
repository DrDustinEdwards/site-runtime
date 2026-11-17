---
"@dustinedwards/site-runtime": minor
---

A suppressed recipient is a known state, not a fault. `./email` exports `RECIPIENT_SUPPRESSED`, `EmailNotSent` (what a
site's sender throws, with the code and none of the provider's words) and `isRecipientSuppressed`, and logs
`email_send_failed` for a suppressed address as a warning. `./sign-in` answers a sign-in link or app code for a
suppressed address with 422 `UNDELIVERABLE_EMAIL`, `requestSignInLink` returns `"undeliverable"` with
`SIGN_IN_WORDS.link.undeliverable`, the account page's email change says `ACCOUNT_WORDS.emailUndeliverable`, and a
security notice to a suppressed address is the warning `security_notice_undeliverable` instead of the error
`security_notice_failed`.
