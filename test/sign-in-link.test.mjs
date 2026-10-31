import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SIGN_IN_EXPIRES_IN_SECONDS,
  confirmEmailLink,
  confirmLinkURL,
  confirmSignInLink,
  emailConfirmURL,
  emailLinkResult,
  signInLinkProblem,
} from "../sign-in-link.mjs";

const VERIFY = "https://example.com/api/auth/magic-link/verify?token=tok&callbackURL=%2Fhome&errorCallbackURL=%2Flogin";
const SENT = 1_800_000_000_000;

/** An auth whose handler records the request it was handed and answers as Better Auth's verify does. */
function fakeAuth(options = {}) {
  const seen = [];
  return {
    seen,
    options,
    handler: async (request) => {
      seen.push(request);
      return new Response(null, { status: 302, headers: { Location: "/home", "Set-Cookie": "session=s; HttpOnly" } });
    },
  };
}

test("the mailed URL is the confirm page on the same origin, with the link's token, callbacks and send time", () => {
  const page = new URL(confirmLinkURL(VERIFY, "/sign-in/confirm", SENT));
  assert.equal(`${page.origin}${page.pathname}`, "https://example.com/sign-in/confirm");
  assert.deepEqual(Object.fromEntries(page.searchParams), { token: "tok", callbackURL: "/home", errorCallbackURL: "/login", sent: String(SENT) });
});

test("only a POST verifies: a GET of the page (a mail scanner) never reaches Better Auth", async () => {
  const auth = fakeAuth();
  const page = confirmLinkURL(VERIFY, "/sign-in/confirm", SENT);
  for (const method of ["GET", "HEAD"]) assert.equal((await confirmSignInLink(auth, new Request(page, { method }))).status, 405);
  assert.equal(auth.seen.length, 0);

  const answer = await confirmSignInLink(
    auth,
    new Request(page, { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.9", "Content-Type": "application/x-www-form-urlencoded" }, body: "" }),
  );
  assert.equal(answer.headers.get("Set-Cookie"), "session=s; HttpOnly", "the session cookie comes back untouched");
  const [verify] = auth.seen;
  assert.equal(verify.method, "GET");
  const url = new URL(verify.url);
  assert.equal(url.pathname, "/api/auth/magic-link/verify", "Better Auth's own endpoint, so its limiter runs");
  assert.equal(url.searchParams.get("errorCallbackURL"), `/login?sent=${SENT}`, "a spent link comes back with its send time");
  assert.equal(verify.headers.get("CF-Connecting-IP"), "203.0.113.9", "the limiter keys on the person's address");
});

test("the form's fields stand in for a URL without the token, and a missing callbackURL redirects to / (never JSON)", async () => {
  const auth = fakeAuth({ basePath: "/auth" });
  await confirmSignInLink(auth, new Request("https://example.com/sign-in/confirm", { method: "POST", body: new URLSearchParams({ token: "tok" }) }));
  assert.equal(auth.seen.at(-1).url, "https://example.com/auth/magic-link/verify?token=tok&callbackURL=%2F&errorCallbackURL=%2Fsign-in%2Fconfirm");
  const empty = await confirmSignInLink(auth, new Request("https://example.com/sign-in/confirm", { method: "POST", body: new URLSearchParams() }));
  assert.equal(empty.status, 400);
});

test("a failed link reads as used or expired by its send time, invalid without one, missing without a token", () => {
  const page = (query) => `https://example.com/sign-in/confirm?${query}`;
  const late = SENT + SIGN_IN_EXPIRES_IN_SECONDS * 1000 + 1;
  assert.equal(signInLinkProblem(page("token=tok&sent=1")), null, "a link not yet pressed shows its button");
  assert.equal(signInLinkProblem(page(`error=INVALID_TOKEN&sent=${SENT}`), { now: SENT + 60_000 }), "used");
  assert.equal(signInLinkProblem(page(`error=INVALID_TOKEN&sent=${SENT}`), { now: late }), "expired");
  assert.equal(signInLinkProblem(page("error=INVALID_TOKEN")), "invalid");
  assert.equal(signInLinkProblem(page("error=failed_to_create_user")), "failed");
  assert.equal(signInLinkProblem(page(`error=INVALID_TOKEN&sent=${SENT}`), { signedIn: true }), "signed-in");
  assert.equal(signInLinkProblem(page("")), "missing");
});

test("an email-change link opens a page that changes nothing on a GET; its POST runs verify-email and lands on the result", async () => {
  // Better Auth's token is a JWT; only its requestType names the step.
  const payload = Buffer.from(JSON.stringify({ email: "old@example.com", updateTo: "new@example.com", requestType: "change-email-confirmation" })).toString("base64url");
  const token = `e30.${payload}.sig`;
  const page = emailConfirmURL(`https://example.com/api/auth/verify-email?token=${token}&callbackURL=%2F`, "/account/email");
  assert.equal(page, `https://example.com/account/email?token=${token}`);

  const auth = fakeAuth();
  assert.equal((await confirmEmailLink(auth, new Request(page))).status, 405);
  assert.equal(auth.seen.length, 0, "a mail scanner's GET approves nothing");
  await confirmEmailLink(auth, new Request(page, { method: "POST" }));
  const verify = new URL(auth.seen[0].url);
  assert.equal(verify.pathname, "/api/auth/verify-email");
  assert.equal(verify.searchParams.get("callbackURL"), "/account/email?done=approved");

  assert.deepEqual(emailLinkResult("https://example.com/account/email?done=approved"), { done: "approved", problem: null });
  assert.deepEqual(emailLinkResult("https://example.com/account/email?done=changed&error=TOKEN_EXPIRED"), { done: null, problem: "expired" });
  assert.deepEqual(emailLinkResult("https://example.com/account/email?error=USER_NOT_FOUND"), { done: null, problem: "done" });
  assert.deepEqual(emailLinkResult("https://example.com/account/email"), { done: null, problem: "missing" });
});
