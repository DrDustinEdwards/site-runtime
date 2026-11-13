/** Newsletter signup with double opt-in (newsletter.mjs), the subscribers kept in D1 `subscribers`. */

/** The migration: `subscribers` (email, consented_at, unsubscribe_token, unsubscribed_at, confirmed_at, confirm_sent_at, ISO times). */
export const SUBSCRIBERS_SQL: string;

export interface SubscriberRow {
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  confirmSentAt: string | null;
}
export interface Confirmation {
  status: "confirm" | "done" | "invalid" | "expired";
  email?: string;
}

/** The four functions a site writes over its table. */
export interface SubscriberStore {
  find(email: string): Promise<SubscriberRow | null>;
  /** Insert a pending row (a fresh unsubscribe token) or, for an existing one, change only `confirm_sent_at`. */
  upsertPending(email: string, confirmSentAt: string | null): Promise<void>;
  /** Confirm and consent at `at`, lift the unsubscribe, clear `confirm_sent_at`, only where it still equals the link's. True when a row changed. */
  confirm(email: string, confirmSentAt: string, at: string): Promise<boolean>;
  /** Set `unsubscribed_at` on the row with this token. True when a row changed. */
  unsubscribe(token: string, at: string): Promise<boolean>;
}

export function newsletter(options: {
  store: SubscriberStore;
  /** Signing keys, newest first (./signed-token). */
  keys: readonly (string | null | undefined)[];
  /** Mails the link, rendered in the site's words; true when it went. */
  send: (mail: {
    email: string;
    url: string;
    token: string;
    expiresIn: string;
  }) => Promise<boolean>;
  origin: string;
  /** Default `/subscribe/confirm`. */
  linkPath?: string;
  /** How long a link works: 7. */
  confirmDays?: number;
  /** One mail per address in this window: 600000. */
  resendMs?: number;
}): {
  /** `email` is trimmed and lowercased first, so a change of case is the same row. */
  request(email: string, now?: Date): Promise<"sent" | "unavailable">;
  check(token: string | null, now?: Date): Promise<Confirmation>;
  confirm(token: string | null, now?: Date): Promise<Confirmation>;
  unsubscribe(token: string | null, now?: Date): Promise<"done" | "invalid">;
};
