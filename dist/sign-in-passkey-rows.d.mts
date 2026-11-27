/**
 * The passkey's provider in words, from its AAGUID, else null (registration stores it as the name, so an unknown one
 * stays blank). With no attestation (as `./sign-in` asks) Apple reports the all-zero AAGUID, so with an iPhone, iPad
 * or Mac user agent a zero reads as Apple Passwords.
 * @param {string | null | undefined} aaguid
 * @param {string | null} [userAgent] the browser that made it, at registration
 * @returns {string | null}
 */
export function knownProvider(aaguid: string | null | undefined, userAgent?: string | null): string | null;
/**
 * The passkey's provider in words, for a page: `knownProvider`, else "Passkey".
 * @param {string | null | undefined} aaguid
 * @param {string | null} [userAgent]
 */
export function passkeyProvider(aaguid: string | null | undefined, userAgent?: string | null): string;
/**
 * What a passkey list shows for one: the name it was given (at registration `./sign-in` stores the provider's), else
 * the provider's, else "Passkey".
 * @param {{ name?: string | null, aaguid?: string | null }} passkey
 */
export function passkeyLabel(passkey: {
    name?: string | null;
    aaguid?: string | null;
}): string;
/**
 * @typedef {{ id: string, name?: string | null, aaguid?: string | null, credentialID?: string | null, createdAt?: Date | string | null }} PasskeyRow
 *   A row of Better Auth's `listPasskeys`.
 */
/** @import { AccountPasskey } from "./sign-in-account.mjs" */
/**
 * The passkeys as a page lists them, oldest first: `id` (for rename and delete), `credentialId` (the public credential
 * id, base64url, for the Signal API in `./sign-in-client`), `name` (passkeyLabel), `provider`, `createdAt` and
 * `lastUsedAt` (from `passkeyLastUsed`, null when unknown). No public key.
 * @param {PasskeyRow[]} passkeys
 * @param {Map<string, Date>} [lastUsed]
 * @returns {AccountPasskey[]}
 */
export function passkeyRows(passkeys: PasskeyRow[], lastUsed?: Map<string, Date>): AccountPasskey[];
/**
 * When each of a person's passkeys last signed them in, by passkey id: the newest passkey sign-in row in
 * `auth_events` (`change` is the passkey's id; rows go after a year, `pruneAuthEvents`). Better Auth keeps no last-used time.
 * @param {D1Like} db @param {string} userId
 * @returns {Promise<Map<string, Date>>}
 */
export function passkeyLastUsed(db: D1Like, userId: string): Promise<Map<string, Date>>;
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
export function accountPasskeys(auth: {
    api: {
        getSession(o: SessionLookup): Promise<{
            user: {
                id: string;
            };
        } | null>;
        listPasskeys(o: {
            headers: Headers;
        }): Promise<PasskeyRow[]>;
    };
}, request: Request, db?: D1Like | null): Promise<AccountPasskey[] | null>;
/** Whether the account page suggests adding another passkey: exactly one, so losing that device locks them out. */
export function needsSecondPasskey(passkeys: unknown[]): boolean;
/**
 * Records a "Not now" on the passkey offer, as an `auth_events` row for the person (so it holds on every device), and
 * never throws.
 * @param {D1Like} db @param {string} userId @param {{ request?: Request | null, at?: number }} [options]
 */
export function dismissPasskeyOffer(db: D1Like, userId: string, { request, at }?: {
    request?: Request | null;
    at?: number;
}): Promise<void>;
/**
 * Whether to offer a passkey after a sign-in by link, code, Google or Apple: the person has none and has not
 * said "Not now" in the last PASSKEY_OFFER_DAYS. The page also checks `canOfferPasskey` (`./sign-in-client`).
 * @param {D1Like} db the site's `eventsDb`
 * @param {string} userId
 * @param {unknown[] | number} passkeys the person's passkeys (`listPasskeys`), or how many
 * @param {number} [now]
 */
export function shouldOfferPasskey(db: D1Like, userId: string, passkeys: unknown[] | number, now?: number): Promise<boolean>;
export const PASSKEY_OFFER_DAYS: 30;
/**
 * A row of Better Auth's `listPasskeys`.
 */
export type PasskeyRow = {
    id: string;
    name?: string | null;
    aaguid?: string | null;
    credentialID?: string | null;
    createdAt?: Date | string | null;
};
export type D1Like = import("./sign-in-audit.mjs").D1Like;
export type SessionLookup = import("./sign-in-account.mjs").SessionLookup;
import type { AccountPasskey } from "./sign-in-account.mjs";
