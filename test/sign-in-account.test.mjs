// The tricky parts of sign-in's account security: reading a user agent, which event a Better Auth request was, and a
// notice that fails to send. The hooks themselves ran against Better Auth 1.7.12 in the PR's end-to-end check.
import assert from "node:assert/strict";
import { test } from "node:test";

import { accountSessions, authEvent, deviceName, passkeyProvider, revokeSessionById, sendNoticeSafely } from "../sign-in-account.mjs";

test("a user agent reads as the browser and system a person would name", () => {
  const cases = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1", "Chrome on iPhone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari on Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge on Windows"],
    ["Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet on Android"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox on Linux"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome on ChromeOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0", "iPhone"],
    ["okhttp/4.12.0", null],
    [undefined, null],
  ];
  for (const [ua, name] of cases) assert.equal(deviceName(ua), name, ua);
  // Apple's own passkeys carry the all-zero AAGUID with attestation "none"; elsewhere a zero names nothing.
  assert.equal(passkeyProvider("00000000-0000-0000-0000-000000000000", cases[0][0]), "Apple Passwords");
  assert.equal(passkeyProvider("00000000-0000-0000-0000-000000000000", cases[3][0]), null);
  assert.equal(passkeyProvider(" EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4 "), "Google Password Manager");
});

/** Better Auth's APIError as an after hook holds it: a refusal, or a redirect (which Better Auth also throws). */
const refused = (code, status = "BAD_REQUEST") => Object.assign(new Error(code), { name: "APIError", status, body: { code } });
const redirect = (location) => Object.assign(new Error(""), { name: "APIError", status: "FOUND", headers: new Headers({ location }) });

test("each Better Auth request maps to its OWASP line, and the changes to a notice", () => {
  const event = (facts) => authEvent({ signedIn: false, returned: { status: true }, ...facts });
  assert.deepEqual(event({ path: "/magic-link/verify", signedIn: true, userId: "u1", returned: redirect("/") }), {
    event: "authn_login_success",
    fields: { via: "link", user_id: "u1" },
  });
  // A spent link redirects with ?error=, which is a failure even though Better Auth answers 302.
  assert.deepEqual(event({ path: "/magic-link/verify", returned: redirect("/login?error=INVALID_TOKEN") }), {
    event: "authn_login_fail",
    fields: { via: "link", code: "INVALID_TOKEN" },
    level: "warn",
    email: undefined,
  });
  assert.equal(event({ path: "/sign-in/email-otp", body: { email: "a@example.com" }, returned: refused("INVALID_OTP") }).email, "a@example.com");
  // An OAuth callback that linked an account makes no session and is told by the account hook, not here.
  assert.equal(event({ path: "/callback/:id", params: { id: "google" }, returned: redirect("/account") }), null);
  assert.equal(event({ path: "/callback/:id", params: { id: "google" }, signedIn: true, returned: redirect("/") }).fields.via, "google");
  assert.deepEqual(event({ path: "/passkey/verify-registration", returned: refused("SESSION_NOT_FRESH", "FORBIDDEN"), userId: "u1" }), {
    event: "authz_fail",
    fields: { reason: "SESSION_NOT_FRESH", endpoint: "/passkey/verify-registration", user_id: "u1" },
    level: "warn",
  });
  assert.deepEqual(event({ path: "/revoke-other-sessions", userId: "u1" }).notice, { kind: "sessions-revoked", scope: "others" });
  assert.equal(event({ path: "/revoke-session", userId: "u1" }).notice, undefined);
  assert.deepEqual(event({ path: "/passkey/verify-registration", returned: { name: "Apple Passwords" } }).notice, {
    kind: "passkey-added",
    passkeyName: "Apple Passwords",
  });
  assert.equal(event({ path: "/passkey/delete-passkey", returned: refused("UNAUTHORIZED", "UNAUTHORIZED") }), null);
  assert.equal(event({ path: "/sign-in/magic-link", body: { email: "a@example.com" } }).event, "authn_token_created");
  assert.equal(event({ path: "/get-session" }), null);
});

test("a notice that fails to send never throws, and its log line holds no address", async () => {
  const lines = [];
  const original = console.error;
  console.error = (/** @type {string} */ line) => lines.push(JSON.parse(line));
  try {
    const send = async () => {
      throw new Error("mail to a@example.com refused");
    };
    await sendNoticeSafely(send, "passkey-added", { user: { id: "u1", email: "a@example.com" }, detail: /** @type {any} */ ({}) });
  } finally {
    console.error = original;
  }
  assert.deepEqual(lines, [{ event: "security_notice_failed", kind: "passkey-added", user_id: "u1", error: "Error: mail to [email] refused" }]);
});

test("revokeSessionById ends only the asker's own session, and the rows carry no token", async () => {
  const sessions = [
    { id: "a", token: "tok-a", userAgent: null, createdAt: "2026-10-30T00:00:00Z" },
    { id: "b", token: "tok-b", userAgent: null, createdAt: "2026-10-31T00:00:00Z" },
  ];
  const revoked = [];
  const auth = {
    api: {
      getSession: async () => ({ session: { token: "tok-a" } }),
      listSessions: async () => sessions,
      revokeSession: async ({ body }) => revoked.push(body.token),
    },
  };
  const request = new Request("https://example.com/account");
  const rows = await accountSessions(auth, request);
  assert.deepEqual(rows.map((row) => [row.id, row.current, "token" in row]), [["a", true, false], ["b", false, false]]);
  assert.equal(await revokeSessionById(auth, request, "b"), true);
  assert.equal(await revokeSessionById(auth, request, "someone-elses"), false);
  assert.deepEqual(revoked, ["tok-b"]);
});
