/**
 * Account security for `./sign-in`, apart from it so it needs no Better Auth import (and `npm test` covers it without
 * one); `./sign-in` re-exports it and runs it from Better Auth's hooks.
 *
 * - THE AUTH EVENT LOG (F2): one `./log` line per sign-in event, named from the OWASP Logging Vocabulary
 *   (OWASP_EVENTS): sign-in success and failure by way in, a link or code sent, a per-address limit hit, sign-out, a
 *   session revoked, a passkey added or removed, a sign-in method linked or unlinked, the email changed, the account
 *   deleted, and a refusal for want of a fresh sign-in. A line holds the user's id and, where there is no user yet, the
 *   address as `emailKey` hashes it; never the address, a token, a code or a session id.
 * - SECURITY NOTICES (A8, E1, NIST SP 800-63B-4 4.1.2.1 and 4.6): the site's `sendSecurityNotice(kind, { user,
 *   request, detail })` hears of each change to how a person signs in, with what happened, when, the device in plain
 *   words, the coarse place Cloudflare saw (`request.cf`) and what to do if it was not them. A failed send is logged
 *   and never undoes or blocks the change.
 * - THE SESSIONS LIST (D5): `sessionRows` turns Better Auth's `listSessions` rows into what a page shows.
 * - PASSKEY NAMES (A5): `passkeyProvider` names a passkey's provider from its AAGUID, so a list never shows a blank.
 */
import { logEvent, OWASP_EVENTS } from "./log.mjs";
import { emailKey } from "./rate-limit/index.mjs";

/** What `sendSecurityNotice` is called for. */
export const SECURITY_NOTICE_KINDS = Object.freeze([
  "passkey-added",
  "passkey-removed",
  "sign-in-linked",
  "sign-in-unlinked",
  "email-changed",
  "sessions-revoked",
  "account-deleted",
]);

// ---- devices and places ---------------------------------------------------------------------------

// First match wins: Edge, Opera and Samsung Internet also say Chrome, Chrome on iOS says Safari, and every browser on an
// iPhone says "like Mac OS X", so the specific names come first.
/** @type {[RegExp, string][]} */
const BROWSERS = [
  [/\b(?:Edg|EdgA|EdgiOS)\//, "Edge"],
  [/\b(?:OPR|OPiOS)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];
/** @type {[RegExp, string][]} */
const SYSTEMS = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

/**
 * The browser and system a user agent names, in plain words ("Safari on iPhone", "Chrome on Windows"), one of them
 * alone when only one is known, or null. An iPad that asks for the desktop site says Macintosh, so it reads as a Mac.
 * @param {string | null | undefined} userAgent
 * @returns {string | null}
 */
export function deviceName(userAgent) {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? null;
}

/**
 * The city, region and country Cloudflare placed a request in (`request.cf`), as words ("Austin, Texas, United States"),
 * or null outside Workers and for a request built by the site.
 * @param {Request & { cf?: { city?: unknown, region?: unknown, country?: unknown } } | null | undefined} request
 * @returns {string | null}
 */
export function coarseLocation(request) {
  const cf = request?.cf;
  if (!cf) return null;
  const country = typeof cf.country === "string" && cf.country ? countryName(cf.country) : null;
  const parts = [cf.city, cf.region, country].filter((part) => typeof part === "string" && part !== "");
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

/** @param {string} code */
function countryName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code; // Cloudflare's own codes (T1 for Tor, XX for unknown) are not regions
  }
}

// ---- the sessions list ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, token: string, userAgent?: string | null, createdAt: Date | string, updatedAt?: Date | string | null, location?: unknown }} SessionRow
 */

/**
 * Better Auth's `listSessions` rows as a page shows them, the current session first, then the most recently active:
 * `device` (deviceName, null when the user agent names nothing), `signedInAt`, `lastActiveAt` (Better Auth moves
 * `updatedAt` only when it extends a session, once per `updateAge`, a day by default, so it is coarse), `current`, and
 * `location` when the site stores one on the session. No token: a row goes into the page, and another device's token
 * there would let a script on the page take over that session. `revokeSessionById` ends one by its `id`.
 * @param {SessionRow[]} sessions
 * @param {string | null | undefined} currentToken the token of the session that asks (`getSession`'s `session.token`)
 */
export function sessionRows(sessions, currentToken) {
  return sessions
    .map((session) => ({
      id: session.id,
      device: deviceName(session.userAgent),
      signedInAt: new Date(session.createdAt),
      lastActiveAt: new Date(session.updatedAt ?? session.createdAt),
      current: Boolean(currentToken) && session.token === currentToken,
      location: typeof session.location === "string" && session.location ? session.location : null,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
}

/**
 * @typedef {{ api: {
 *   getSession(o: { headers: Headers }): Promise<{ session: { token: string } } | null>,
 *   listSessions(o: { headers: Headers }): Promise<SessionRow[]>,
 *   revokeSession(o: { headers: Headers, body: { token: string } }): Promise<unknown>,
 * } }} SessionsAuth
 */

/**
 * The sessions list for the person who asks (`sessionRows`), or null when Better Auth wants a fresh sign-in first
 * (`/list-sessions` refuses with SESSION_NOT_FRESH), so a page offers "sign in again" rather than failing.
 * @param {SessionsAuth} auth
 * @param {Request} request
 */
export async function accountSessions(auth, request) {
  const headers = request.headers;
  try {
    const [current, sessions] = await Promise.all([auth.api.getSession({ headers }), auth.api.listSessions({ headers })]);
    return sessionRows(sessions, current?.session.token);
  } catch (error) {
    if (/** @type {{ body?: { code?: string } }} */ (error)?.body?.code === "SESSION_NOT_FRESH") return null;
    throw error;
  }
}

/**
 * Ends one of the asker's own sessions by its `id`, through Better Auth's /revoke-session, so no token leaves the
 * server. False when the id is not one of theirs. Throws SESSION_NOT_FRESH as `listSessions` does.
 * @param {SessionsAuth} auth
 * @param {Request} request
 * @param {string} id
 */
export async function revokeSessionById(auth, request, id) {
  const headers = request.headers;
  const session = (await auth.api.listSessions({ headers })).find((row) => row.id === id);
  if (!session) return false;
  await auth.api.revokeSession({ headers, body: { token: session.token } });
  return true;
}

// ---- passkey names ---------------------------------------------------------------------------------

/**
 * The providers people use, by AAGUID, named as passkeydeveloper/passkey-authenticator-aaguids (aaguid.json, read
 * 2026-10-31) names them; the rest of that list is security keys and SDKs. Better Auth stores the AAGUID on each
 * passkey row.
 */
const PROVIDERS = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "Apple Passwords",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain (Managed)",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "771b48fd-d3d4-4f74-9232-fc157ab0507a": "Edge on Mac",
  "d3452668-01fd-4c12-926c-83a4204853aa": "Microsoft Password Manager",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "b78a0a55-6ef8-d246-a042-ba0f6d55050c": "LastPass",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "f3809540-7f14-49c1-a8b3-8f813b225541": "Enpass",
  "fdb141b2-5d84-443e-8a35-4698c205a502": "KeePassXC",
};
const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000";

/**
 * The passkey's provider in words, from its AAGUID, else null. Apple's own passkeys report the all-zero AAGUID when
 * the site asks for no attestation (as `./sign-in` does), so with the user agent of an iPhone, iPad or Mac a zero
 * reads as Apple Passwords, the provider every browser there saves to unless the person picked another, which has its
 * own AAGUID.
 * @param {string | null | undefined} aaguid
 * @param {string | null | undefined} [userAgent] the browser that made it, at registration
 * @returns {string | null}
 */
export function passkeyProvider(aaguid, userAgent) {
  const id = aaguid?.trim().toLowerCase();
  if (id && Object.hasOwn(PROVIDERS, id)) return PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (id)];
  if ((!id || id === ZERO_AAGUID) && /\b(?:iPhone|iPad|Macintosh)\b/.test(userAgent ?? "")) return "Apple Passwords";
  return null;
}

/**
 * What a passkey list shows for one: the name it was given (at registration `./sign-in` stores the provider's), else
 * the provider's, else "Passkey".
 * @param {{ name?: string | null, aaguid?: string | null }} passkey
 */
export function passkeyLabel(passkey) {
  return passkey.name?.trim() || passkeyProvider(passkey.aaguid) || "Passkey";
}

// ---- which event a request was ------------------------------------------------------------------

/** The ways in, by Better Auth endpoint. `/callback/:id` and `/sign-in/social` name the provider instead. */
const SIGN_IN_VIA = { "/magic-link/verify": "link", "/sign-in/email-otp": "code", "/passkey/verify-authentication": "passkey" };
/** The endpoints that mail a sign-in link or code. */
const SENT_VIA = { "/sign-in/magic-link": "link", "/email-otp/send-verification-otp": "code" };
/** The session revocations, and which sessions each ends. */
const REVOKED = { "/revoke-session": "one", "/revoke-sessions": "all", "/revoke-other-sessions": "others" };
/** Refusals for want of a recent sign-in: the fresh-session middleware's, and /delete-user's own. */
const NOT_FRESH = new Set(["SESSION_NOT_FRESH", "SESSION_EXPIRED"]);

/**
 * How an endpoint ended, from what Better Auth's after hook holds (`ctx.context.returned`): an APIError for a refusal,
 * and for a redirect, which Better Auth also throws, a failure only when the location carries `error`.
 * @param {unknown} returned
 * @returns {{ ok: boolean, code?: string }}
 */
export function outcome(returned) {
  const error =
    /** @type {{ name?: unknown, status?: unknown, statusCode?: unknown, body?: { code?: unknown }, headers?: unknown }} */ (
      returned
    );
  if (!error || typeof error !== "object" || error.name !== "APIError") return { ok: true };
  if (error.status === "FOUND" || error.statusCode === 302) {
    const headers = /** @type {{ get?: (name: string) => string | null }} */ (error.headers);
    const location = typeof headers?.get === "function" ? headers.get("location") : null;
    const code = location ? new URL(location, "http://x").searchParams.get("error") : null;
    return code ? { ok: false, code } : { ok: true };
  }
  const code = typeof error.body?.code === "string" ? error.body.code : String(error.status ?? error.statusCode ?? "error");
  return { ok: false, code };
}

/**
 * @typedef {{
 *   path: string, params?: Record<string, string | undefined>, body?: Record<string, unknown>, returned: unknown,
 *   signedIn: boolean, userId?: string | null, linking?: boolean,
 * }} EndpointFacts
 *   What one Better Auth request was: its endpoint path, route params and body, what it returned, whether it made a
 *   session (`ctx.context.newSession`), whose session it ran in, and for an OAuth callback whether it linked an account
 *   rather than signing in.
 * @typedef {{ event: string, fields: Record<string, unknown>, level?: "warn", email?: unknown, notice?: { kind: string, scope?: string, passkeyName?: string } }} AuthEvent
 */

/**
 * The log line, and the notice if any, for one Better Auth request, or null for a request that is not an auth event.
 * Linking an account, the email change and the account's deletion are told by `./sign-in`'s database hooks instead,
 * which see the account's provider and both addresses.
 * @param {EndpointFacts} facts
 * @returns {AuthEvent | null}
 */
export function authEvent({ path, params, body, returned, signedIn, userId, linking }) {
  const result = outcome(returned);
  const user = userId ? { user_id: userId } : {};
  if (!result.ok && result.code && NOT_FRESH.has(result.code)) {
    return { event: OWASP_EVENTS.authorizationFailure, fields: { reason: result.code, endpoint: path, ...user }, level: "warn" };
  }
  const via = Object.hasOwn(SIGN_IN_VIA, path)
    ? SIGN_IN_VIA[/** @type {keyof typeof SIGN_IN_VIA} */ (path)]
    : path === "/callback/:id"
      ? params?.id
      : path === "/sign-in/social" && body?.idToken
        ? String(body.provider)
        : null;
  if (via) {
    if (signedIn) return { event: OWASP_EVENTS.signInSuccess, fields: { via, ...user } };
    if (result.ok) return null; // an OAuth callback that linked (told by the account hook), or a sign-in started
    if (linking)
      return { event: OWASP_EVENTS.userUpdated, fields: { change: "sign_in_linked", via, code: result.code }, level: "warn" };
    return { event: OWASP_EVENTS.signInFailure, fields: { via, code: result.code }, level: "warn", email: body?.email };
  }
  if (!result.ok) return null;
  if (Object.hasOwn(SENT_VIA, path)) {
    return {
      event: OWASP_EVENTS.signInLinkSent,
      fields: { via: SENT_VIA[/** @type {keyof typeof SENT_VIA} */ (path)] },
      email: body?.email,
    };
  }
  if (path === "/sign-out") return { event: OWASP_EVENTS.signOut, fields: {} };
  if (Object.hasOwn(REVOKED, path)) {
    const scope = REVOKED[/** @type {keyof typeof REVOKED} */ (path)];
    return {
      event: OWASP_EVENTS.sessionExpired,
      fields: { reason: "revoked", scope, ...user },
      ...(scope === "one" ? {} : { notice: { kind: "sessions-revoked", scope } }),
    };
  }
  if (path === "/passkey/verify-registration") {
    const name = /** @type {{ name?: unknown }} */ (returned)?.name;
    return {
      event: OWASP_EVENTS.userUpdated,
      fields: { change: "passkey_added", ...user },
      notice: { kind: "passkey-added", ...(typeof name === "string" && name ? { passkeyName: name } : {}) },
    };
  }
  if (path === "/passkey/delete-passkey") {
    return {
      event: OWASP_EVENTS.userUpdated,
      fields: { change: "passkey_removed", ...user },
      notice: { kind: "passkey-removed" },
    };
  }
  return null;
}

/**
 * Writes an event's line, the address hashed as `emailKey` hashes it (`email_key`), never in clear.
 * @param {Pick<AuthEvent, "event" | "fields" | "level" | "email">} event
 */
export async function logAuthEvent({ event, fields, level, email }) {
  const key = typeof email === "string" ? await emailKey("email", email) : null;
  logEvent(event, { ...fields, ...(key ? { email_key: key } : {}) }, level ? { level } : {});
}

// ---- security notices -------------------------------------------------------------------------------

const PROVIDER_NAMES = /** @type {Record<string, string>} */ ({ google: "Google", apple: "Apple" });

/** @param {string | undefined} providerId */
export const providerName = (providerId) => (providerId && PROVIDER_NAMES[providerId]) || providerId || "A sign-in method";

/**
 * @typedef {{
 *   title: string, what: string | null, at: Date, when: string, device: string | null, location: string | null, secure: string,
 *   scope?: string, passkeyName?: string, provider?: string, oldEmail?: string, newEmail?: string,
 * }} NoticeDetail
 *   `title` for the subject and heading, `what` a sentence only when the title leaves something out (else null), `at` and `when` (in words, UTC), the device and place of the request
 *   that made the change (null when unknown), and `secure`: what to do if it was not the person.
 */

const IF_NOT_YOU =
  "If this was not you, sign in now, remove any passkey or sign-in method you do not recognize, and sign out of every other device.";
const CONTACT = (/** @type {string} */ site) => `If this was not you, contact ${site} right away.`;

/**
 * The words of a notice, for the site's mail (Capsomer's `securityNotice` takes them as they are).
 * @param {string} kind one of SECURITY_NOTICE_KINDS
 * @param {{ siteName: string, at?: Date, userAgent?: string | null, request?: Request | null, scope?: string,
 *   passkeyName?: string, provider?: string, oldEmail?: string, newEmail?: string, toOldAddress?: boolean }} facts
 * @returns {NoticeDetail}
 */
export function noticeDetail(kind, { siteName, at = new Date(), userAgent, request, toOldAddress, ...facts }) {
  const provider = providerName(facts.provider);
  /** @type {Record<string, [string, string | null, string]>} */
  const words = {
    "passkey-added": [
      `A passkey${facts.passkeyName ? ` from ${facts.passkeyName}` : ""} was added to your account`,
      null,
      IF_NOT_YOU,
    ],
    "passkey-removed": ["A passkey was removed from your account", null, IF_NOT_YOU],
    "sign-in-linked": [`You can now sign in with ${provider}`, null, IF_NOT_YOU],
    "sign-in-unlinked": [`You can no longer sign in with ${provider}`, null, IF_NOT_YOU],
    "email-changed": [
      "Your account's email address changed",
      `It changed from ${facts.oldEmail} to ${facts.newEmail}.`,
      toOldAddress ? `${CONTACT(siteName)} Sign-in links now go to the new address.` : IF_NOT_YOU,
    ],
    "sessions-revoked": [
      facts.scope === "others" ? "You were signed out on your other devices" : "You were signed out everywhere",
      null,
      "If this was not you, sign in again and check your passkeys and sign-in methods.",
    ],
    "account-deleted": ["Your account and its data were deleted", null, CONTACT(siteName)],
  };
  const [title, what, secure] = words[kind];
  return {
    title,
    what,
    at,
    when: `${at.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" })} UTC`,
    device: deviceName(userAgent ?? request?.headers.get("user-agent")),
    location: coarseLocation(request),
    secure,
    ...(facts.scope ? { scope: facts.scope } : {}),
    ...(facts.passkeyName ? { passkeyName: facts.passkeyName } : {}),
    ...(facts.provider ? { provider } : {}),
    ...(facts.oldEmail ? { oldEmail: facts.oldEmail, newEmail: facts.newEmail } : {}),
  };
}

/**
 * @typedef {{ id: string, email: string, name?: string | null }} NoticeUser
 * @typedef {(kind: string, notice: { user: NoticeUser, request?: Request, detail: NoticeDetail }) => Promise<void> | void} SendSecurityNotice
 */

/**
 * Calls the site's sender and never throws: a failure is logged (`security_notice_failed`, the kind and the error with
 * any address cut out) and the change it tells of stands.
 * @param {SendSecurityNotice} send
 * @param {string} kind
 * @param {{ user: NoticeUser, request?: Request, detail: NoticeDetail }} notice
 */
export async function sendNoticeSafely(send, kind, notice) {
  try {
    await send(kind, notice);
  } catch (error) {
    logEvent("security_notice_failed", { kind, user_id: notice.user.id, error }, { level: "error" });
  }
}
