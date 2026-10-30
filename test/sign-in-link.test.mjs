import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmLinkURL, confirmSignInLink } from "../sign-in-link.mjs";

const VERIFY = "https://example.com/api/auth/magic-link/verify?token=tok&callbackURL=%2Fhome&errorCallbackURL=%2Flogin";

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

test("the mailed URL is the confirm page on the same origin, with the link's token and callbacks", () => {
  const page = new URL(confirmLinkURL(VERIFY, "/sign-in/confirm"));
  assert.equal(`${page.origin}${page.pathname}`, "https://example.com/sign-in/confirm");
  assert.deepEqual(Object.fromEntries(page.searchParams), { token: "tok", callbackURL: "/home", errorCallbackURL: "/login" });
});

test("only a POST verifies: a GET of the page (a mail scanner) never reaches Better Auth", async () => {
  const auth = fakeAuth();
  const page = confirmLinkURL(VERIFY, "/sign-in/confirm");
  for (const method of ["GET", "HEAD"]) assert.equal((await confirmSignInLink(auth, new Request(page, { method }))).status, 405);
  assert.equal(auth.seen.length, 0);

  const answer = await confirmSignInLink(
    auth,
    new Request(page, { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.9", "Content-Type": "application/x-www-form-urlencoded" }, body: "" }),
  );
  assert.equal(answer.headers.get("Set-Cookie"), "session=s; HttpOnly", "the session cookie comes back untouched");
  const [verify] = auth.seen;
  assert.equal(verify.method, "GET");
  assert.equal(verify.url, VERIFY, "Better Auth's own endpoint, so its limiter runs");
  assert.equal(verify.headers.get("CF-Connecting-IP"), "203.0.113.9", "the limiter keys on the person's address");
});

test("the form's fields stand in for a URL without the token, and a missing callbackURL redirects to / (never JSON)", async () => {
  const auth = fakeAuth({ basePath: "/auth" });
  await confirmSignInLink(auth, new Request("https://example.com/sign-in/confirm", { method: "POST", body: new URLSearchParams({ token: "tok" }) }));
  assert.equal(auth.seen.at(-1).url, "https://example.com/auth/magic-link/verify?token=tok&callbackURL=%2F");
  const empty = await confirmSignInLink(auth, new Request("https://example.com/sign-in/confirm", { method: "POST", body: new URLSearchParams() }));
  assert.equal(empty.status, 400);
});
