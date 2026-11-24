/**
 * Posts the allow list. `removed` names people this change just took out, so Capsid frees their seats; anyone still in
 * `members` is not sent as removed. Never throws: a refusal or a network failure is the `refusal` of the result.
 * @param {{
 *   key: string,
 *   namespace: string,
 *   members: string[],
 *   removed?: string[],
 *   origin?: string,
 *   fetch?: typeof fetch,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<{ ok: true, added: number, dropped: number } | { ok: false, refusal: string }>}
 */
export function postAccessSync({ key, namespace, members, removed, origin, fetch: fetcher, timeoutMs, }: {
    key: string;
    namespace: string;
    members: string[];
    removed?: string[];
    origin?: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
}): Promise<{
    ok: true;
    added: number;
    dropped: number;
} | {
    ok: false;
    refusal: string;
}>;
/**
 * @typedef {| { ok: true; added: number; dropped: number }
 * | { ok: false; refusal: string }} AccessSyncResult
 */
/** Where Capsid answers unless an app names another origin (a preview Capsid). */
export const CAPSID_ORIGIN: "https://mcp.dustinedwards.info";
export type AccessSyncResult = {
    ok: true;
    added: number;
    dropped: number;
} | {
    ok: false;
    refusal: string;
};
