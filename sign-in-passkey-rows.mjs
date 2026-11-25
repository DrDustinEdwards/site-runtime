import { OWASP_EVENTS } from "./log.mjs";
import { recordAuthEvent } from "./sign-in-audit.mjs";
import { sessionLookup } from "./sign-in-sessions.mjs";

/** @typedef {import("./sign-in-audit.mjs").D1Like} D1Like */
/** @typedef {import("./sign-in-sessions.mjs").SessionLookup} SessionLookup */

/**
 * The providers people use, by AAGUID, named as passkeydeveloper/passkey-authenticator-aaguids (aaguid.json, read
 * 2026-10-31); the YubiKey 5 entries are the retail models in the FIDO Metadata Service (blob 293, read 2026-10-31).
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
 * The passkey's provider in words, from its AAGUID, else null (registration stores it as the name, so an unknown one
 * stays blank). With no attestation (as `./sign-in` asks) Apple reports the all-zero AAGUID, so with an iPhone, iPad
 * or Mac user agent a zero reads as Apple Passwords.
 * @param {string | null | undefined} aaguid
 * @param {string | null} [userAgent] the browser that made it, at registration
 * @returns {string | null}
 */
export function knownProvider(aaguid, userAgent) {
  const id = aaguid?.trim().toLowerCase();
  if (id && Object.hasOwn(PROVIDERS, id))
    return PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (id)];
  if ((!id || id === ZERO_AAGUID) && /\b(?:iPhone|iPad|Macintosh)\b/.test(userAgent ?? ""))
    return "Apple Passwords";
  return null;
}

/**
 * The passkey's provider in words, for a page: `knownProvider`, else "Passkey".
 * @param {string | null | undefined} aaguid
 * @param {string | null} [userAgent]
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
 * `auth_events` (`change` is the passkey's id; rows go after a year, `pruneAuthEvents`). Better Auth keeps no last-used time.
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
 * `eventsDb`; null when nobody is signed in. Listing and renaming need no fresh sign-in; deleting does (FRESH_SECONDS).
 * @param {{ api: {
 *   getSession(o: SessionLookup): Promise<{ user: { id: string } } | null>,
 *   listPasskeys(o: { headers: Headers }): Promise<PasskeyRow[]>,
 * } }} auth
 * @param {Request} request
 * @param {D1Like | null} [db]
 */
export async function accountPasskeys(auth, request, db) {
  const headers = request.headers;
  const found = await auth.api.getSession(sessionLookup(request));
  if (!found) return null;
  const [passkeys, lastUsed] = await Promise.all([
    auth.api.listPasskeys({ headers }),
    db ? passkeyLastUsed(db, found.user.id) : Promise.resolve(new Map()),
  ]);
  return passkeyRows(passkeys, lastUsed);
}

/** Whether the account page suggests adding another passkey: exactly one, so losing that device locks them out. */
export function needsSecondPasskey(/** @type {unknown[]} */ passkeys) {
  return passkeys.length === 1;
}

export const PASSKEY_OFFER_DAYS = 30;
/** The `auth_events` event of a "Not now" on the passkey offer: no log line, not in the security history. */
const PASSKEY_OFFER_DISMISSED = "passkey_offer_dismissed";

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
 * Whether to offer a passkey after a sign-in by link, code, Google or Apple: the person has none and has not
 * said "Not now" in the last PASSKEY_OFFER_DAYS. The page also checks `canOfferPasskey` (`./sign-in-client`).
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
