/**
 * Newsletter signup with double opt-in, from Germomics (app/lib/newsletter.server.ts). A signup is only a request: the
 * address stays pending (never sent the newsletter) until its owner opens the signed link mailed to it, and a signup
 * for an address that unsubscribed does not resubscribe it without that confirmation either, so nobody can put someone
 * else's address on the list or undo their opt-out (CAN-SPAM, GDPR consent).
 *
 * The link is the signed token (./signed-token) over `{ p, e, at }`: `at` is the row's `confirm_sent_at`, which the
 * confirmation must match and then clears, so a link works once, an older link stops working when a newer one is sent,
 * and a used link cannot resubscribe the address after a later unsubscribe.
 *
 * What a site brings: the store (four functions over its `subscribers` table, SUBSCRIBERS_SQL), the keys, the mail
 * (it renders it, in its own words), and the routes. Opening a link only reads (`check`, the page's GET: mail scanners
 * open every link); the change happens on the POST (`confirm`).
 */

import { readSignedToken, signToken } from "./signed-token.mjs";

/** The migration: a D1 site adds it as its next file. Times are ISO strings. A row with no `confirmed_at` is pending. */
export const SUBSCRIBERS_SQL = `CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  consented_at TEXT,
  unsubscribe_token TEXT,
  unsubscribed_at TEXT,
  confirmed_at TEXT,
  confirm_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_idx ON subscribers (email);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_token_idx ON subscribers (unsubscribe_token);
`;

const PURPOSE = "subscribe";

/**
 * @typedef {{ confirmedAt: string | null, unsubscribedAt: string | null, confirmSentAt: string | null }} SubscriberRow
 * @typedef {{ status: "confirm" | "done" | "invalid" | "expired", email?: string }} Confirmation
 */

/**
 * A double opt-in list over the site's store.
 * @param {{
 *   store: {
 *     find(email: string): Promise<SubscriberRow | null>,
 *     upsertPending(email: string, confirmSentAt: string | null): Promise<void>,
 *     confirm(email: string, confirmSentAt: string, at: string): Promise<boolean>,
 *     unsubscribe(token: string, at: string): Promise<boolean>,
 *   },
 *   keys: readonly (string | null | undefined)[],
 *   send: (mail: { email: string, url: string, token: string, expiresIn: string }) => Promise<boolean>,
 *   origin: string,
 *   linkPath?: string,
 *   confirmDays?: number,
 *   resendMs?: number,
 * }} options `store.upsertPending` inserts a pending row with a fresh unsubscribe token or, for one that exists,
 *   changes only `confirm_sent_at` (a pending row stays pending, an unsubscribed one stays unsubscribed); `confirm`
 *   sets confirmed and consented to `at`, clears the unsubscribe and `confirm_sent_at`, only where `confirm_sent_at`
 *   still equals the link's, and answers whether a row changed; `unsubscribe` sets `unsubscribed_at` on the row with
 *   that token. `send` answers whether the mail went. `origin` and `linkPath` (default `/subscribe/confirm`) make
 *   the link; `confirmDays` (default 7) is how long it works; `resendMs` (default 10 minutes) is the one mail per
 *   address in that window, so the form cannot flood someone's inbox.
 */
export function newsletter({
  store,
  keys,
  send,
  origin,
  linkPath = "/subscribe/confirm",
  confirmDays = 7,
  resendMs = 10 * 60_000,
}) {
  const configured = () => keys.some(Boolean);

  /**
   * @param {string | null} token
   * @returns {Promise<{ e: string, at: string } | null>}
   */
  async function readClaim(token) {
    if (!token || !configured()) return null;
    const payload = await readSignedToken(keys, token);
    if (payload?.p !== PURPOSE || typeof payload.e !== "string" || typeof payload.at !== "string")
      return null;
    return { e: payload.e, at: payload.at };
  }

  /**
   * @param {string | null} token
   * @param {Date} now
   * @returns {Promise<{ result: Confirmation, claim?: { e: string, at: string } }>}
   */
  async function inspect(token, now) {
    const claim = await readClaim(token);
    if (!claim) return { result: { status: "invalid" } };
    if (now.getTime() - Date.parse(claim.at) > confirmDays * 86_400_000)
      return { result: { status: "expired", email: claim.e } };
    const row = await store.find(claim.e);
    if (row?.confirmSentAt === claim.at)
      return { result: { status: "confirm", email: claim.e }, claim };
    // Opened again after confirming: already done. Anything else (a link a newer one replaced, or one used before a
    // later unsubscribe) no longer works.
    if (row?.confirmedAt && !row.unsubscribedAt && !row.confirmSentAt)
      return { result: { status: "done", email: claim.e } };
    return { result: { status: "invalid" } };
  }

  return {
    /**
     * Ask for `email` to join: mail it a confirmation link. "sent" also answers an address already on the list or one
     * mailed in the last few minutes (no mail goes; the page says the same either way, so it reveals nothing).
     * "unavailable" is no key, or a mail that did not go (the send time is undone, so the person can try at once).
     * @param {string} email trimmed and lowercased here, so a change of case is the same row and the same window
     * @param {Date} [now]
     * @returns {Promise<"sent" | "unavailable">}
     */
    async request(email, now = new Date()) {
      if (!configured()) return "unavailable";
      email = email.trim().toLowerCase();
      const row = await store.find(email);
      if (row?.confirmedAt && !row.unsubscribedAt) return "sent";
      if (row?.confirmSentAt && now.getTime() - Date.parse(row.confirmSentAt) < resendMs)
        return "sent";
      const at = now.toISOString();
      await store.upsertPending(email, at);
      const token = await signToken(keys, { p: PURPOSE, e: email, at });
      const url = `${origin}${linkPath}?token=${encodeURIComponent(token)}`;
      if (!(await send({ email, url, token, expiresIn: `${confirmDays} days` }))) {
        await store.upsertPending(email, row?.confirmSentAt ?? null);
        return "unavailable";
      }
      return "sent";
    },

    /**
     * What the link is for, read only: the page's GET.
     * @param {string | null} token
     * @param {Date} [now]
     * @returns {Promise<Confirmation>}
     */
    async check(token, now = new Date()) {
      return (await inspect(token, now)).result;
    },

    /**
     * Confirm the subscription the link is for: the page's POST. On the list from now, any earlier unsubscribe lifted.
     * @param {string | null} token
     * @param {Date} [now]
     * @returns {Promise<Confirmation>}
     */
    async confirm(token, now = new Date()) {
      const { result, claim } = await inspect(token, now);
      if (result.status !== "confirm" || !claim) return result;
      return (await store.confirm(claim.e, claim.at, now.toISOString()))
        ? { status: "done", email: claim.e }
        : { status: "invalid" };
    },

    /**
     * Unsubscribe the row with this token (the page's POST, never its GET). The row is kept, so a later signup does
     * not silently resurrect it.
     * @param {string | null} token
     * @param {Date} [now]
     * @returns {Promise<"done" | "invalid">}
     */
    async unsubscribe(token, now = new Date()) {
      if (!token) return "invalid";
      return (await store.unsubscribe(token, now.toISOString())) ? "done" : "invalid";
    },
  };
}
