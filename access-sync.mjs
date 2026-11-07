/**
 * Access sync: a site (or Carrel) asks Capsid to make its Cloudflare Access group hold exactly its list of people. Capsid
 * is the only holder of the Cloudflare token (Dustin's ruling of 2026-10-09), so an app posts the whole list to Capsid's
 * `POST /ops/access-sync` with its own agent key. Capsid writes the group it pinned for the namespace (never one the
 * request names), frees the Zero Trust seats of the people in `removed`, and audits the call. The whole list is sent each
 * time, so a missed sync is mended by the next.
 *
 * This is only the call and the reading of the answer. Which people are on the list, where the outcome is kept and what
 * the page says stay the app's own. The key goes in the Authorization header and is never put in a result.
 */

/** Where Capsid answers unless an app names another origin (a preview Capsid). */
export const CAPSID_ORIGIN = "https://mcp.dustinedwards.info";

const TIMEOUT_MS = 15_000;

/**
 * Capsid's refusal in its own words: the JSON `refusal` on a 409 or 502 (Cloudflare said no), else the plain text of a
 * refusal that came before Cloudflare (401, 403, 409 with no pin, 503 with no token).
 * @param {Response} response
 */
async function refusalOf(response) {
  const text = (await response.text()).slice(0, 600);
  try {
    const body = /** @type {{ refusal?: unknown }} */ (JSON.parse(text));
    if (typeof body.refusal === "string" && body.refusal) return body.refusal;
  } catch {
    // Plain text: the words are Capsid's own.
  }
  const notSetUp = /CF_ACCESS_SYNC_TOKEN is not set/.test(text)
    ? " Access sync is not set up yet at Capsid, so nothing was changed in Cloudflare Access."
    : "";
  return `Capsid answered ${response.status}: ${text.trim() || response.statusText || "no reason given"}.${notSetUp}`;
}

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
export async function postAccessSync({
  key,
  namespace,
  members,
  removed = [],
  origin = CAPSID_ORIGIN,
  fetch: fetcher = fetch,
  timeoutMs = TIMEOUT_MS,
}) {
  const lower = members.map((email) => email.toLowerCase());
  const gone = removed
    .map((email) => email.toLowerCase())
    .filter((email) => !lower.includes(email));
  let response;
  try {
    response = await fetcher(`${origin.replace(/\/+$/, "")}/ops/access-sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ namespace, members: lower, removed: gone }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ok: false,
      refusal: `Capsid could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) return { ok: false, refusal: await refusalOf(response) };
  const text = await response.text();
  /** @type {{ ok?: unknown, added?: unknown, dropped?: unknown } | null} */
  let result = null;
  try {
    result = JSON.parse(text);
  } catch {
    result = null;
  }
  if (result?.ok !== true) {
    return {
      ok: false,
      refusal: `Capsid answered ${response.status}: ${text.trim().slice(0, 600) || "no reason given"}.`,
    };
  }
  return {
    ok: true,
    added: Array.isArray(result.added) ? result.added.length : 0,
    dropped: Array.isArray(result.dropped) ? result.dropped.length : 0,
  };
}
