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
export function newsletter({ store, keys, send, origin, linkPath, confirmDays, resendMs, }: {
    store: {
        find(email: string): Promise<SubscriberRow | null>;
        upsertPending(email: string, confirmSentAt: string | null): Promise<void>;
        confirm(email: string, confirmSentAt: string, at: string): Promise<boolean>;
        unsubscribe(token: string, at: string): Promise<boolean>;
    };
    keys: readonly (string | null | undefined)[];
    send: (mail: {
        email: string;
        url: string;
        token: string;
        expiresIn: string;
    }) => Promise<boolean>;
    origin: string;
    linkPath?: string;
    confirmDays?: number;
    resendMs?: number;
}): {
    /**
     * Ask for `email` to join: mail it a confirmation link. "sent" also answers an address already on the list or one
     * mailed in the last few minutes (no mail goes; the page says the same either way, so it reveals nothing).
     * "unavailable" is no key, or a mail that did not go (the send time is undone, so the person can try at once).
     * @param {string} email trimmed and lowercased here, so a change of case is the same row and the same window
     * @param {Date} [now]
     * @returns {Promise<"sent" | "unavailable">}
     */
    request(email: string, now?: Date): Promise<"sent" | "unavailable">;
    /**
     * What the link is for, read only: the page's GET.
     * @param {string | null} token
     * @param {Date} [now]
     * @returns {Promise<Confirmation>}
     */
    check(token: string | null, now?: Date): Promise<Confirmation>;
    /**
     * Confirm the subscription the link is for: the page's POST. On the list from now, any earlier unsubscribe lifted.
     * @param {string | null} token
     * @param {Date} [now]
     * @returns {Promise<Confirmation>}
     */
    confirm(token: string | null, now?: Date): Promise<Confirmation>;
    /**
     * Unsubscribe the row with this token (the page's POST, never its GET). The row is kept, so a later signup does
     * not silently resurrect it.
     * @param {string | null} token
     * @param {Date} [now]
     * @returns {Promise<"done" | "invalid">}
     */
    unsubscribe(token: string | null, now?: Date): Promise<"done" | "invalid">;
};
/**
 * The four functions a site writes over its table.
 *
 * - `upsertPending`: Insert a pending row (a fresh unsubscribe token) or, for an existing one, change only `confirm_sent_at`.
 * - `confirm`: Confirm and consent at `at`, lift the unsubscribe, clear `confirm_sent_at`, only where it still equals the link's. True when a row changed.
 * - `unsubscribe`: Set `unsubscribed_at` on the row with this token. True when a row changed.
 * @typedef {{ find(email: string): Promise<SubscriberRow | null>; upsertPending(email: string, confirmSentAt: string | null): Promise<void>; confirm(email: string, confirmSentAt: string, at: string): Promise<boolean>; unsubscribe(token: string, at: string): Promise<boolean>; }} SubscriberStore
 */
/** The migration: a D1 site adds it as its next file. Times are ISO strings. A row with no `confirmed_at` is pending. */
export const SUBSCRIBERS_SQL: "CREATE TABLE IF NOT EXISTS subscribers (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  email TEXT NOT NULL,\n  consented_at TEXT,\n  unsubscribe_token TEXT,\n  unsubscribed_at TEXT,\n  confirmed_at TEXT,\n  confirm_sent_at TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\nCREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_idx ON subscribers (email);\nCREATE UNIQUE INDEX IF NOT EXISTS subscribers_token_idx ON subscribers (unsubscribe_token);\n";
export type SubscriberRow = {
    confirmedAt: string | null;
    unsubscribedAt: string | null;
    confirmSentAt: string | null;
};
export type Confirmation = {
    status: "confirm" | "done" | "invalid" | "expired";
    email?: string;
};
/**
 * The four functions a site writes over its table.
 *
 * - `upsertPending`: Insert a pending row (a fresh unsubscribe token) or, for an existing one, change only `confirm_sent_at`.
 * - `confirm`: Confirm and consent at `at`, lift the unsubscribe, clear `confirm_sent_at`, only where it still equals the link's. True when a row changed.
 * - `unsubscribe`: Set `unsubscribed_at` on the row with this token. True when a row changed.
 */
export type SubscriberStore = {
    find(email: string): Promise<SubscriberRow | null>;
    upsertPending(email: string, confirmSentAt: string | null): Promise<void>;
    confirm(email: string, confirmSentAt: string, at: string): Promise<boolean>;
    unsubscribe(token: string, at: string): Promise<boolean>;
};
