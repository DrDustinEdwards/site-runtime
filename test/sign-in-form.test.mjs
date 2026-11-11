import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_WORDS,
  SIGN_IN_WORDS,
  accountFormAction,
  accountOptions,
  authHandler,
  isDisposableEmail,
  safeNextPath,
  signInFormAction,
} from "../sign-in-form.mjs";

/** An auth whose handler records each request and answers with `reply(path, body)`. */
function fakeAuth(reply) {
  const seen = [];
  return {
    seen,
    options: { baseURL: "https://example.com", basePath: "/api/auth" },
    handler: async (request) => {
      const body = await request.json();
      seen.push({ path: new URL(request.url).pathname, headers: request.headers, body });
      return reply(new URL(request.url).pathname, body);
    },
  };
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const page = (fields) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
};

const request = () =>
  new Request("https://example.com/login", {
    method: "POST",
    headers: {
      Origin: "https://example.com",
      "CF-Connecting-IP": "203.0.113.9",
      Cookie: "other=1",
      "User-Agent": "UA",
    },
  });

const site = {
  landing: (next) => `/passkey?next=${encodeURIComponent(next)}`,
  errorLanding: "/sign-in/confirm",
};

test("a next path is a path on this site; every escape falls back", () => {
  for (const ok of [
    "/console",
    "/oauth/authorize?redirect_uri=https%3A%2F%2Fa.example%2Fcb&resource=https://b.example",
    "%2Fsettings%2Faccount",
  ])
    assert.equal(
      safeNextPath(ok, { fallback: "/x" }),
      ok.startsWith("%") ? "/settings/account" : ok,
    );
  for (const bad of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/café",
    "%2F%2Fevil",
    "%E0%A4%A",
    null,
    7,
  ])
    assert.equal(safeNextPath(bad, { fallback: "/x" }), "/x", String(bad));
  assert.equal(safeNextPath("/account/passkeys", { within: ["/account"] }), "/account/passkeys");
  assert.equal(safeNextPath("/accounting", { within: ["/account"] }), "/");
});

test("a disposable domain is caught at any depth, and a real one is not", () => {
  assert.equal(isDisposableEmail("a@mailinator.com"), true);
  assert.equal(isDisposableEmail("a@x.MAILINATOR.com."), true);
  assert.equal(isDisposableEmail("a@example.com"), false);
  assert.equal(isDisposableEmail("no-at-sign"), false);
});

test("the link request goes through the handler with only the origin, client address and agent, and the token", async () => {
  const auth = fakeAuth(() => json(200, { status: true }));
  const result = await signInFormAction(
    auth,
    request(),
    page({ email: " reader@example.com ", next: "//evil.example", "cf-turnstile-response": "tok" }),
    site,
  );
  assert.deepEqual(result, {
    state: { sent: "reader@example.com", error: null, codeError: null },
    status: 200,
  });
  const [{ path, headers, body }] = auth.seen;
  assert.equal(path, "/api/auth/sign-in/magic-link");
  assert.equal(headers.get("cf-connecting-ip"), "203.0.113.9");
  assert.equal(headers.get("x-captcha-response"), "tok");
  assert.equal(headers.get("cookie"), null);
  assert.equal(body.callbackURL, "/passkey?next=%2F");
  assert.equal(body.errorCallbackURL, "/sign-in/confirm");
});

test("each refusal of the link says the site's reason, never the address's", async () => {
  const cases = [
    [json(429, { code: "EMAIL_RATE_LIMITED" }), "email-limited", 429],
    [json(429, {}), "limited", 429],
    [json(400, { code: "MISSING_RESPONSE" }), "check-failed", 400],
    [json(503, { code: "TURNSTILE_NOT_SET" }), "unavailable", 503],
    [json(500, {}), "failed", 500],
  ];
  for (const [answer, kind, status] of cases) {
    const result = await signInFormAction(
      fakeAuth(() => answer.clone()),
      request(),
      page({ email: "a@example.com" }),
      site,
    );
    assert.deepEqual(
      result,
      { state: { sent: null, error: SIGN_IN_WORDS.link[kind], codeError: null }, status },
      kind,
    );
  }
});

test("a right code redirects with only the session cookies; a wrong one stays on the code screen", async () => {
  const signedIn = fakeAuth(() =>
    json(200, { token: "t" }, { "Set-Cookie": "session=s; HttpOnly; Secure; SameSite=Lax" }),
  );
  const ok = await signInFormAction(
    signedIn,
    request(),
    page({ intent: "code", email: "a@example.com", code: "123 456", next: "/console" }),
    site,
  );
  assert.equal(ok.location, "/passkey?next=%2Fconsole");
  assert.deepEqual(ok.headers.getSetCookie(), ["session=s; HttpOnly; Secure; SameSite=Lax"]);
  assert.deepEqual(signedIn.seen[0].body, { email: "a@example.com", otp: "123456" });

  for (const [code, kind] of [
    ["INVALID_OTP", "wrong"],
    ["OTP_EXPIRED", "expired"],
    ["TOO_MANY_ATTEMPTS", "spent"],
    ["disposable_email", "disposable"],
  ]) {
    const result = await signInFormAction(
      fakeAuth(() => json(400, { code })),
      request(),
      page({ intent: "code", email: "a@example.com", code: "000000" }),
      site,
    );
    assert.deepEqual(result.state, {
      sent: "a@example.com",
      error: null,
      codeError: SIGN_IN_WORDS.code[kind],
    });
  }
  const short = fakeAuth(() => json(200, {}));
  const typo = await signInFormAction(
    short,
    request(),
    page({ intent: "code", email: "a@example.com", code: "12" }),
    site,
  );
  assert.equal(typo.state.codeError, SIGN_IN_WORDS.noCode);
  assert.equal(short.seen.length, 0);
});

test("Better Auth's answers are no-store unless they say otherwise", async () => {
  const plain = await authHandler({ handler: async () => new Response("{}") }, request());
  assert.equal(plain.headers.get("Cache-Control"), "no-store");
  const own = await authHandler(
    {
      handler: async () =>
        new Response("{}", { headers: { "Cache-Control": "private, max-age=0" } }),
    },
    request(),
  );
  assert.equal(own.headers.get("Cache-Control"), "private, max-age=0");
});

test("both email-change mails carry the site's confirm page, never Better Auth's GET link", async () => {
  const sent = [];
  const options = accountOptions({
    confirmPath: "/email/confirm",
    sendEmailChange: (mail) => void sent.push(mail),
    beforeDelete: async () => {},
  });
  const verify = "https://example.com/api/auth/verify-email?token=abc&callbackURL=%2F";
  await options.user.changeEmail.sendChangeEmailConfirmation({
    user: { email: "old@example.com" },
    newEmail: "new@example.com",
    url: verify,
    token: "abc",
  });
  await options.emailVerification.sendVerificationEmail({
    user: { email: "new@example.com" },
    url: verify,
    token: "abc",
  });
  assert.deepEqual(
    sent.map((m) => [m.to, m.step, m.link]),
    [
      ["old@example.com", "current", "https://example.com/email/confirm?token=abc"],
      ["new@example.com", "new", "https://example.com/email/confirm?token=abc"],
    ],
  );
  assert.ok(options.disabledPaths.includes("/delete-user"));
});

test("a new account at a disposable address is refused by the real Better Auth, beside a site's own user hook", async () => {
  const { betterAuth } = await import("better-auth");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const { signInOptions } = await import("../sign-in.mjs");
  const options = await signInOptions(
    { BETTER_AUTH_URL: "https://example.com", TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET_KEY: "s" },
    { siteName: "Sample", sendMagicLink: async () => {} },
  );
  const mem = { user: [], session: [], account: [], verification: [], rateLimit: [] };
  const siteHook = [];
  const auth = betterAuth({
    database: memoryAdapter(mem),
    secret: "sample-secret-sample-secret-sample-secret",
    baseURL: "https://example.com",
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: true },
    plugins: options.plugins.filter((plugin) => plugin.id === "no-disposable-email"),
    databaseHooks: { user: { create: { before: async (user) => void siteHook.push(user.email) } } },
  });
  const signUp = (email) =>
    auth.api.signUpEmail({ body: { email, password: "sample-password-1", name: "A" } });
  await assert.rejects(
    signUp("a@mailinator.com"),
    (error) => error.body?.code === "disposable_email",
  );
  await signUp("b@example.com");
  assert.deepEqual(
    mem.user.map((u) => u.email),
    ["b@example.com"],
  );
  assert.ok(siteHook.includes("b@example.com"), "the site's own hook still ran");
});

test("the account page's posts on the real Better Auth: email change, delete, and a stale sign-in", async () => {
  const { betterAuth } = await import("better-auth");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const mails = [];
  const options = accountOptions({
    confirmPath: "/email/confirm",
    sendEmailChange: async (mail) => void mails.push(mail),
    beforeDelete: async () => {},
  });
  const mem = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    ...options,
    database: memoryAdapter(mem),
    secret: "sample-secret-sample-secret-sample-secret",
    baseURL: "https://example.com",
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: true },
    databaseHooks: {
      user: { create: { before: async (user) => ({ data: { ...user, emailVerified: true } }) } },
    },
  });
  const signedUp = await auth.api.signUpEmail({
    body: { email: "a@example.com", password: "sample-password-1", name: "A" },
    asResponse: true,
  });
  const cookie = signedUp.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const post = (fields) =>
    accountFormAction(
      auth,
      new Request("https://example.com/account", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://example.com" },
      }),
      page(fields),
      {
        deletedLanding: "/signin?deleted=1",
        beforeDelete: async (_user, form) =>
          form.get("handover") === "none" ? "Hand it over first." : null,
      },
    );

  assert.equal(await post({ intent: "profile" }), null, "a site's own post is left to it");
  for (const [newEmail, words] of [
    ["a@example.com", ACCOUNT_WORDS.sameEmail],
    ["b@mailinator.com", ACCOUNT_WORDS.disposable],
    ["not-an-address", ACCOUNT_WORDS.noEmail],
  ])
    assert.equal((await post({ intent: "change-email", newEmail })).state.error, words, newEmail);
  assert.equal(mails.length, 0);
  const sent = await post({ intent: "change-email", newEmail: "B@example.com" });
  assert.deepEqual([sent.status, sent.state.sentTo], [200, "a@example.com"]);
  assert.deepEqual(
    mails.map((m) => [m.to, m.step, m.newEmail]),
    [["a@example.com", "current", "b@example.com"]],
    "the current address approves first",
  );

  assert.equal((await post({ intent: "delete-account" })).state.error, ACCOUNT_WORDS.noConfirm);
  assert.equal(
    (await post({ intent: "delete-account", confirm: "on", handover: "none" })).state.error,
    "Hand it over first.",
  );
  assert.equal(mem.user.length, 1);

  // A sign-in older than FRESH_SECONDS: each post asks for a new one, and nothing is deleted.
  for (const session of mem.session) session.createdAt = new Date(Date.now() - 11 * 60 * 1000);
  const stale = await post({ intent: "delete-account", confirm: "on" });
  assert.deepEqual([stale.status, stale.state.stale], [403, true]);
  assert.equal(mem.user.length, 1);

  for (const session of mem.session) session.createdAt = new Date();
  const deleted = await post({ intent: "delete-account", confirm: "on" });
  assert.equal(deleted.location, "/signin?deleted=1");
  assert.ok(deleted.headers.getSetCookie().length > 0, "the cookies are cleared");
  assert.deepEqual([mem.user.length, mem.session.length], [0, 0]);
});
