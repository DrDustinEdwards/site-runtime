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
 * - SECURITY HISTORY (E5): with the site's D1 (`eventsDb`), each event is also a row in `auth_events`
 *   (AUTH_EVENTS_SQL); `securityHistory` reads a person's sign-ins, passkey and email changes back with date and device,
 *   and `authEventCounts` gives /health's spike check (`./health` authSpikeCheck) its counts.
 * - FRESH SIGN-IN (A7, D6): `requireFreshSession` for a site's own risky routes (export, delete), the same 10-minute
 *   rule `./sign-in` holds Better Auth's endpoints to.
 * - THE SESSIONS LIST (D5): `sessionRows` turns Better Auth's `listSessions` rows into what a page shows. With
 *   `sessionDetails` (`./sign-in`) each session also keeps its coarse place and when it was last used
 *   (`sessionTouch`), and a long-lived random device id from a cookie (E4's new-device notice reads it).
 * - PASSKEYS (A3, A5, A9): `passkeyProvider` names a passkey's provider from its AAGUID, so a list never shows a blank;
 *   `accountPasskeys` gives a page each passkey with its name, provider, when made and when last used (with
 *   `eventsDb`); `shouldOfferPasskey` and `dismissPasskeyOffer` keep the offer of a passkey after another sign-in to
 *   people with none who have not just said "Not now"; `needsSecondPasskey` is the nudge toward a second one.
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
  "new-device",
  "recovery",
]);

/**
 * How recent a sign-in must be for a risky change: 10 minutes. `./sign-in` sets Better Auth's session.freshAge to it,
 * and its own check holds passkey delete and email change to it too (Better Auth 1.7.12 does not).
 */
export const FRESH_SECONDS = 10 * 60;

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
 * The city, region and country Cloudflare placed a request in (`request.cf`), as words ("Portland, Oregon, United States"),
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

// ---- session details: place, last active, device ---------------------------------------------------

/** How often a session's last activity is written: at most once in five minutes (txasm's touch). */
export const SESSION_TOUCH_SECONDS = 5 * 60;

/**
 * The device cookie (`sessionDetails`): a random id, signed, set at each sign-in and kept 400 days (the longest a
 * browser keeps a cookie, RFC 6265bis), stored on the session row as `deviceId`. Better Auth names it with its prefix:
 * `__Secure-better-auth.device` on https. Clear-Site-Data at sign-out clears it, so the next sign-in there is a new device.
 */
export const DEVICE_COOKIE = "device";
export const DEVICE_COOKIE_SECONDS = 400 * 24 * 60 * 60;

/**
 * The session columns `sessionDetails` needs, as a migration a site adds (drop a line for a column it has already;
 * txasm and Foxhound have `location`). In a Drizzle schema: `location: text("location")`, `deviceId: text("device_id")`.
 * With `eventsDb`, AUTH_EVENTS_DEVICE_SQL as well.
 */
export const SESSION_DETAILS_SQL = `ALTER TABLE session ADD COLUMN location TEXT;
ALTER TABLE session ADD COLUMN device_id TEXT;
`;

/** The `auth_events` column for the device id of each sign-in, with `sessionDetails` and `eventsDb`. */
export const AUTH_EVENTS_DEVICE_SQL = `ALTER TABLE auth_events ADD COLUMN device_id TEXT;
`;

/**
 * What to write to a session on use, or null when nothing: `updatedAt` now once SESSION_TOUCH_SECONDS have passed since
 * the last write (with `location` when it is known), or at once when the row has no place yet and this request has one
 * (txasm's rule). Better Auth's sliding refresh is off (`./sign-in`), so nothing else moves `updatedAt`, and freshness
 * counts from `createdAt`, so a touch never makes a sign-in look recent.
 * @param {{ updatedAt?: Date | string | null, createdAt?: Date | string | null, location?: unknown }} session
 * @param {string | null} place `coarseLocation` of the request, null when unknown
 * @param {number} [now]
 * @returns {{ updatedAt: Date, location?: string } | null}
 */
export function sessionTouch(session, place, now = Date.now()) {
  const last = new Date(session.updatedAt ?? session.createdAt ?? 0).getTime();
  const stale = !(now - last < SESSION_TOUCH_SECONDS * 1000);
  const placeless = Boolean(place) && !session.location;
  if (!stale && !placeless) return null;
  return { updatedAt: new Date(now), ...(place ? { location: place } : {}) };
}

/**
 * Whether a sign-in's device is new to the person, by device id when their sessions or history carry any (a browser
 * that brought no cookie, or another person's, is new), else by `deviceName` of the user agent as before. A first
 * sign-in is no new device.
 * @param {{ id: string | null, name: string | null }} device
 * @param {{ ids: (string | null)[], names: (string | null)[] }} seen
 */
export function isNewSignInDevice(device, seen) {
  const ids = seen.ids.filter(Boolean);
  if (ids.length > 0 && device.id) return !ids.includes(device.id);
  return isNewDevice(device.name, seen.names);
}

// ---- the sessions list ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, token: string, userAgent?: string | null, createdAt: Date | string, updatedAt?: Date | string | null, location?: unknown }} SessionRow
 */

/**
 * Better Auth's `listSessions` rows as a page shows them, the current session first, then the most recently active:
 * `device` (deviceName, null when the user agent names nothing), `signedInAt`, `lastActiveAt` (`updatedAt`, which
 * with `sessionDetails` moves on use, at most every SESSION_TOUCH_SECONDS; without it Better Auth never moves it, since
 * refresh is off, so it is the sign-in time), `current`, and `location` when the site stores one on the session. No token: a row goes into the page, and another device's token
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

// ---- fresh sign-in -----------------------------------------------------------------------------------

/**
 * Whether a session was made within `freshSeconds`. @param {{ createdAt: Date | string | number }} session
 * @param {number} [freshSeconds] @param {number} [now]
 */
export function sessionIsFresh(session, freshSeconds = FRESH_SECONDS, now = Date.now()) {
  return now - new Date(session.createdAt).getTime() < freshSeconds * 1000;
}

/**
 * The refusal for want of a recent sign-in, in Better Auth's shape (403, `body.code` "SESSION_NOT_FRESH"), so the
 * "sign in again" a page shows for Better Auth's own refusal works for a site's route too.
 */
export class SessionNotFresh extends Error {
  constructor() {
    super("Session is not fresh");
    this.name = "SessionNotFresh";
    this.status = "FORBIDDEN";
    this.statusCode = 403;
    this.body = { code: "SESSION_NOT_FRESH", message: "Session is not fresh" };
  }
}

/**
 * The asker's session when it was made in the last FRESH_SECONDS, null when nobody is signed in, and a throw of
 * SessionNotFresh (logged as `authz_fail`) when the sign-in is older: for a site's own risky routes, such as exporting
 * or deleting an account, which Better Auth's freshAge does not reach.
 * @template {{ session: { createdAt: Date | string }, user: { id: string } }} S
 * @param {{ api: { getSession(o: { headers: Headers }): Promise<S | null> } }} auth
 * @param {Request} request
 * @returns {Promise<S | null>}
 */
export async function requireFreshSession(auth, request) {
  const found = await auth.api.getSession({ headers: request.headers });
  if (!found) return null;
  if (sessionIsFresh(found.session)) return found;
  await logAuthEvent({
    event: OWASP_EVENTS.authorizationFailure,
    fields: { reason: "SESSION_NOT_FRESH", endpoint: new URL(request.url).pathname, user_id: found.user.id },
    level: "warn",
  });
  throw new SessionNotFresh();
}

// ---- passkey names ---------------------------------------------------------------------------------

/**
 * The providers people use, by AAGUID, named as passkeydeveloper/passkey-authenticator-aaguids (aaguid.json, read
 * 2026-10-31) names them; the rest of that list is security keys and SDKs. The YubiKey 5 entries are the retail models
 * in the FIDO Metadata Service that list's combined view draws on (mds3.fidoalliance.org, blob 293, read 2026-10-31),
 * previews and enterprise profiles left out. Names only, no icons. Better Auth stores the AAGUID on each passkey row.
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
  "cb69481e-8ff7-4039-93ec-0a2729a154a8": "YubiKey 5 Series",
  "ee882879-721c-4913-9775-3dfcce97072a": "YubiKey 5 Series",
  "19083c3d-8383-4b18-bc03-8f1c9ab2fd1b": "YubiKey 5 Series",
  "ff4dac45-ede8-4ec2-aced-cf66103f4335": "YubiKey 5 Series",
  "0a357157-9b18-4c8a-920e-d156e972b2f8": "YubiKey 5 Series",
  "fa2b99dc-9e39-4257-8f92-4a30d23c4118": "YubiKey 5 Series with NFC",
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": "YubiKey 5 Series with NFC",
  "a25342c0-3cdc-4414-8e46-f4807fca511c": "YubiKey 5 Series with NFC",
  "d7781e5d-e353-46aa-afe2-3ca49f13332a": "YubiKey 5 Series with NFC",
  "f4ce5fc0-57d3-46f5-a736-efb7d5bc63b5": "YubiKey 5 Series with NFC",
  "c5ef55ff-ad9a-4b9f-b580-adebafe026d0": "YubiKey 5 Series with Lightning",
  "a02167b9-ae71-4ac7-9a07-06432ebb6f1c": "YubiKey 5 Series with Lightning",
  "24673149-6c86-42e7-98d9-433fb5b73296": "YubiKey 5 Series with Lightning",
  "73bb0cd4-e502-49b8-9c6f-b59445bf720b": "YubiKey 5 FIPS Series",
  "57f7de54-c807-4eab-b1c6-1c9be7984e92": "YubiKey 5 FIPS Series",
  "c1f9a0bc-1dd2-404a-b27f-8e29047a43fd": "YubiKey 5 FIPS Series with NFC",
  "fcc0118f-cd45-435b-8da1-9782b2da0715": "YubiKey 5 FIPS Series with NFC",
};
const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000";

/**
 * The passkey's provider in words, from its AAGUID, else null: what registration stores as the name, so an unknown
 * one stays blank and a later list can still name it. Apple's own passkeys report the all-zero AAGUID when the site
 * asks for no attestation (as `./sign-in` does), so with the user agent of an iPhone, iPad or Mac a zero reads as Apple
 * Passwords, the provider every browser there saves to unless the person picked another, which has its own AAGUID.
 * @param {string | null | undefined} aaguid
 * @param {string | null | undefined} [userAgent] the browser that made it, at registration
 * @returns {string | null}
 */
export function knownProvider(aaguid, userAgent) {
  const id = aaguid?.trim().toLowerCase();
  if (id && Object.hasOwn(PROVIDERS, id)) return PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (id)];
  if ((!id || id === ZERO_AAGUID) && /\b(?:iPhone|iPad|Macintosh)\b/.test(userAgent ?? "")) return "Apple Passwords";
  return null;
}

/**
 * The passkey's provider in words, for a page: `knownProvider`, else "Passkey".
 * @param {string | null | undefined} aaguid
 * @param {string | null | undefined} [userAgent]
 */
export function passkeyProvider(aaguid, userAgent) {
  return knownProvider(aaguid, userAgent) ?? "Passkey";
}

/**
 * What a passkey list shows for one: the name it was given (at registration `./sign-in` stores the provider's), else
 * the provider's, else "Passkey".
 * @param {{ name?: string | null, aaguid?: string | null }} passkey
 */
export function passkeyLabel(passkey) {
  return passkey.name?.trim() || passkeyProvider(passkey.aaguid);
}

/**
 * @typedef {{ id: string, name?: string | null, aaguid?: string | null, credentialID?: string | null, createdAt?: Date | string | null }} PasskeyRow
 *   A row of Better Auth's `listPasskeys`.
 * @typedef {{ id: string, credentialId: string | null, name: string, provider: string, createdAt: Date | null, lastUsedAt: Date | null }} AccountPasskey
 */

/**
 * The passkeys as a page lists them, oldest first: `id` (for rename and delete), `credentialId` (the public credential
 * id, base64url, for the Signal API in `./sign-in-client`), `name` (passkeyLabel), `provider`, `createdAt` and
 * `lastUsedAt` (from `passkeyLastUsed`, null when unknown). No public key.
 * @param {PasskeyRow[]} passkeys
 * @param {Map<string, Date>} [lastUsed]
 * @returns {AccountPasskey[]}
 */
export function passkeyRows(passkeys, lastUsed = new Map()) {
  return passkeys
    .map((passkey) => ({
      id: passkey.id,
      credentialId: passkey.credentialID ?? null,
      name: passkeyLabel(passkey),
      provider: passkeyProvider(passkey.aaguid),
      createdAt: passkey.createdAt ? new Date(passkey.createdAt) : null,
      lastUsedAt: lastUsed.get(passkey.id) ?? null,
    }))
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
}

/**
 * When each of a person's passkeys last signed them in, by passkey id: the newest passkey sign-in row in
 * `auth_events`, which `./sign-in` writes with the passkey's id in `change`. Rows go after a year (`pruneAuthEvents`),
 * so a passkey unused for a year has none. Better Auth 1.7.12 keeps no last-used time of its own.
 * @param {D1Like} db @param {string} userId
 * @returns {Promise<Map<string, Date>>}
 */
export async function passkeyLastUsed(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT change AS id, MAX(at) AS at FROM auth_events WHERE user_id = ?1 AND event = '${OWASP_EVENTS.signInSuccess}'
       AND via = 'passkey' AND change IS NOT NULL GROUP BY change`,
    )
    .bind(userId)
    .all();
  return new Map(results.map((row) => [String(row.id), new Date(Number(row.at))]));
}

/**
 * The asker's passkeys for the account page (`passkeyRows`), with when each was last used when `db` is the site's
 * `eventsDb`; null when nobody is signed in. Listing needs no fresh sign-in, and neither does renaming one
 * (`authClient.passkey.updatePasskey({ id, name })`); deleting one does (FRESH_SECONDS).
 * @param {{ api: {
 *   getSession(o: { headers: Headers }): Promise<{ user: { id: string } } | null>,
 *   listPasskeys(o: { headers: Headers }): Promise<PasskeyRow[]>,
 * } }} auth
 * @param {Request} request
 * @param {D1Like | null} [db]
 */
export async function accountPasskeys(auth, request, db) {
  const headers = request.headers;
  const found = await auth.api.getSession({ headers });
  if (!found) return null;
  const [passkeys, lastUsed] = await Promise.all([
    auth.api.listPasskeys({ headers }),
    db ? passkeyLastUsed(db, found.user.id) : Promise.resolve(new Map()),
  ]);
  return passkeyRows(passkeys, lastUsed);
}

/** Whether the account page suggests adding another passkey (A9): exactly one, so losing that device locks them out. */
export function needsSecondPasskey(/** @type {unknown[]} */ passkeys) {
  return passkeys.length === 1;
}

/** How long a "Not now" on the passkey offer holds: 30 days. */
export const PASSKEY_OFFER_DAYS = 30;
/** The `auth_events` event of a "Not now" on the passkey offer: no log line, not in the security history. */
export const PASSKEY_OFFER_DISMISSED = "passkey_offer_dismissed";

/**
 * Records a "Not now" on the passkey offer, as an `auth_events` row for the person (so it holds on every device), and
 * never throws.
 * @param {D1Like} db @param {string} userId @param {{ request?: Request | null, at?: number }} [options]
 */
export function dismissPasskeyOffer(db, userId, { request, at } = {}) {
  return recordAuthEvent(db, {
    event: PASSKEY_OFFER_DISMISSED,
    fields: { user_id: userId },
    userAgent: request?.headers.get("user-agent"),
    request,
    at,
  });
}

/**
 * Whether to offer a passkey after a sign-in by link, code, Google or Apple (A3): the person has none and has not
 * said "Not now" in the last PASSKEY_OFFER_DAYS. The page also asks the browser (`canOfferPasskey` in
 * `./sign-in-client`) and skips the offer on a device with no platform authenticator.
 * @param {D1Like} db the site's `eventsDb`
 * @param {string} userId
 * @param {unknown[] | number} passkeys the person's passkeys (`listPasskeys`), or how many
 * @param {number} [now]
 */
export async function shouldOfferPasskey(db, userId, passkeys, now = Date.now()) {
  if ((typeof passkeys === "number" ? passkeys : passkeys.length) > 0) return false;
  const { results } = await db
    .prepare("SELECT 1 FROM auth_events WHERE user_id = ?1 AND event = ?2 AND at >= ?3 LIMIT 1")
    .bind(userId, PASSKEY_OFFER_DISMISSED, now - PASSKEY_OFFER_DAYS * 24 * 60 * 60 * 1000)
    .all();
  return results.length === 0;
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
 * Writes an event's line, the address hashed as `emailKey` hashes it (`email_key`), never in clear; with `db`, also
 * its `auth_events` row (`recordAuthEvent`).
 * @param {Pick<AuthEvent, "event" | "fields" | "level" | "email">} event
 * @param {{ db?: D1Like | null, userAgent?: string | null, request?: Request | null, deviceId?: string | null }} [where]
 *   `deviceId` (string or null) only with `sessionDetails`, whose migration adds the column
 */
export async function logAuthEvent({ event, fields, level, email }, { db, userAgent, request, deviceId } = {}) {
  const key = typeof email === "string" ? await emailKey("email", email) : null;
  logEvent(event, { ...fields, ...(key ? { email_key: key } : {}) }, level ? { level } : {});
  if (db) await recordAuthEvent(db, { event, fields, userAgent: userAgent ?? request?.headers.get("user-agent"), request, deviceId });
}

// ---- the event table and the security history ----------------------------------------------------------

/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, all(): Promise<{ results: any[] }> } } }} D1Like
 */

/**
 * The migration: a site that passes `eventsDb` adds it as its next file under `migrations/`. One row per auth event:
 * `at` in epoch ms, the OWASP `event`, the `change` or `scope` its line carries (for a passkey sign-in, the passkey's
 * id, `passkeyLastUsed`), the way in (`via`), and the device
 * and coarse place of the request. No address, token or code. `user_id` is null before there is a user (a failed
 * sign-in, a link mailed), and those rows are kept 30 days, a person's own a year (`pruneAuthEvents`).
 */
export const AUTH_EVENTS_SQL = `CREATE TABLE IF NOT EXISTS auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  change TEXT,
  via TEXT,
  user_id TEXT,
  device TEXT,
  location TEXT
);
CREATE INDEX IF NOT EXISTS auth_events_user ON auth_events (user_id, at);
CREATE INDEX IF NOT EXISTS auth_events_at ON auth_events (at, event);
`;

/**
 * Writes one event's row. A failed write is logged (`auth_event_write_failed`) and never stops the sign-in. `deviceId`
 * (string or null) writes the `device_id` column too (AUTH_EVENTS_DEVICE_SQL); left out, the row is written without it.
 * @param {D1Like} db
 * @param {{ event: string, fields: Record<string, unknown>, userAgent?: string | null, request?: Request | null, at?: number, deviceId?: string | null }} row
 */
export async function recordAuthEvent(db, { event, fields, userAgent, request, at = Date.now(), deviceId }) {
  const text = (/** @type {unknown} */ value) => (typeof value === "string" && value ? value : null);
  const values = [at, event, text(fields.change) ?? text(fields.scope) ?? text(fields.passkey_id), text(fields.via), text(fields.user_id), deviceName(userAgent), coarseLocation(request)];
  const withDevice = deviceId !== undefined;
  try {
    await db
      .prepare(
        withDevice
          ? "INSERT INTO auth_events (at, event, change, via, user_id, device, location, device_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
          : "INSERT INTO auth_events (at, event, change, via, user_id, device, location) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      )
      .bind(...values, ...(withDevice ? [text(deviceId)] : []))
      .run();
  } catch (error) {
    logEvent("auth_event_write_failed", { event, error }, { level: "error" });
  }
}

/** What a person's history shows, by its row's event and change. */
const HISTORY_KINDS = /** @type {const} */ ({
  passkey_added: "passkey-added",
  passkey_removed: "passkey-removed",
  sign_in_linked: "sign-in-linked",
  sign_in_unlinked: "sign-in-unlinked",
  email_changed: "email-changed",
  recovered: "recovery",
});

/**
 * A person's security history, newest first: each sign-in (`kind` "sign-in", with `via`), passkey added or removed,
 * sign-in method linked or unlinked, email change and recovery, with `at`, `device` and `location`.
 * @param {D1Like} db
 * @param {string} userId
 * @param {number} [limit]
 * @returns {Promise<{ kind: string, via: string | null, at: Date, device: string | null, location: string | null }[]>}
 */
export async function securityHistory(db, userId, limit = 50) {
  const changes = Object.keys(HISTORY_KINDS);
  const { results } = await db
    .prepare(
      `SELECT at, event, change, via, device, location FROM auth_events WHERE user_id = ?1
       AND (event = '${OWASP_EVENTS.signInSuccess}' OR (event = '${OWASP_EVENTS.userUpdated}' AND change IN (${changes.map((c) => `'${c}'`).join(", ")})))
       ORDER BY at DESC, id DESC LIMIT ?2`,
    )
    .bind(userId, limit)
    .all();
  return results.map((row) => ({
    kind: row.event === OWASP_EVENTS.signInSuccess ? "sign-in" : HISTORY_KINDS[/** @type {keyof typeof HISTORY_KINDS} */ (row.change)],
    via: row.via ?? null,
    at: new Date(row.at),
    device: row.device ?? null,
    location: row.location ?? null,
  }));
}

/**
 * The devices a person has signed in from (`deviceName`, null for an agent it cannot name), from their history.
 * @param {D1Like} db @param {string} userId
 * @returns {Promise<(string | null)[]>}
 */
export async function signedInDevices(db, userId) {
  const { results } = await db
    .prepare(`SELECT DISTINCT device FROM auth_events WHERE user_id = ?1 AND event = '${OWASP_EVENTS.signInSuccess}'`)
    .bind(userId)
    .all();
  return results.map((row) => row.device ?? null);
}

/**
 * The device ids a person has signed in from, from their history (`sessionDetails` with AUTH_EVENTS_DEVICE_SQL).
 * @param {D1Like} db @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function signedInDeviceIds(db, userId) {
  const { results } = await db
    .prepare(`SELECT DISTINCT device_id FROM auth_events WHERE user_id = ?1 AND event = '${OWASP_EVENTS.signInSuccess}' AND device_id IS NOT NULL`)
    .bind(userId)
    .all();
  return results.map((row) => String(row.device_id));
}

/** Whether a person's history shows a passkey added, so a sign-in with none left is a recovery. @param {D1Like} db @param {string} userId */
export async function hadPasskey(db, userId) {
  const { results } = await db
    .prepare(`SELECT 1 FROM auth_events WHERE user_id = ?1 AND event = '${OWASP_EVENTS.userUpdated}' AND change = 'passkey_added' LIMIT 1`)
    .bind(userId)
    .all();
  return results.length > 0;
}

/**
 * Whether a sign-in's device is one the person has not signed in from before: they have signed in before (another
 * session, or a sign-in in their history) and never from this device. A first sign-in is no new device.
 * @param {string | null} device @param {(string | null)[]} seen
 */
export function isNewDevice(device, seen) {
  return seen.length > 0 && !seen.includes(device);
}

/**
 * Failed sign-ins and sign-in mails since `sinceMs`, for /health's spike check.
 * @param {D1Like} db @param {number} sinceMs
 * @returns {Promise<{ failures: number, mails: number }>}
 */
export async function authEventCounts(db, sinceMs) {
  const { results } = await db
    .prepare(
      `SELECT SUM(event = '${OWASP_EVENTS.signInFailure}') AS failures, SUM(event = '${OWASP_EVENTS.signInLinkSent}') AS mails
       FROM auth_events WHERE at >= ?1`,
    )
    .bind(sinceMs)
    .all();
  return { failures: Number(results[0]?.failures ?? 0), mails: Number(results[0]?.mails ?? 0) };
}

/**
 * Deletes rows with no user after 30 days and every row after a year: a site runs it as a daily job (`./cron`).
 * Deleting an account deletes that person's rows at once (`./sign-in`).
 * @param {D1Like} db @param {number} [now]
 */
export async function pruneAuthEvents(db, now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  await db.prepare("DELETE FROM auth_events WHERE (user_id IS NULL AND at < ?1) OR at < ?2").bind(now - 30 * day, now - 365 * day).run();
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
    "new-device": [
      "A new device signed in to your account",
      null,
      "If this was not you, sign in now, end that device's session, and check your passkeys and sign-in methods.",
    ],
    "recovery": [
      "You signed in by email, with no passkey on your account",
      "Every other device was signed out. Add a passkey now so you can sign in without email next time.",
      IF_NOT_YOU,
    ],
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
