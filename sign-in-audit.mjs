import { logEvent, OWASP_EVENTS } from "./log.mjs";
import { emailKey } from "./rate-limit/index.mjs";
import { coarseLocation, deviceName } from "./sign-in-device.mjs";

/** @typedef {import("./sign-in-notice.mjs").SecurityNoticeKind} SecurityNoticeKind */

/**
 * @property {| "sign-in" | "passkey-added" | "passkey-removed" | "sign-in-linked" | "sign-in-unlinked" | "email-changed" | "recovery"} kind
 * @property {string | null} via The way in for a sign-in ("link", "code", "passkey", "google", "apple"), the provider for a link or unlink.
 * @property {Date} at
 * @property {string | null} device
 * @property {string | null} location
 
 */
/** @import { SecurityHistoryEntry } from "./sign-in-account.mjs" */

/**
 * Whether a sign-in's device is new to the person, by device id when their sessions or history carry any, else by
 * `deviceName` of the user agent. A first sign-in is no new device.
 * @param {{ id: string | null, name: string | null }} device
 * @param {{ ids: (string | null)[], names: (string | null)[] }} seen
 */
export function isNewSignInDevice(device, seen) {
  const ids = seen.ids.filter(Boolean);
  if (ids.length > 0 && device.id) return !ids.includes(device.id);
  return isNewDevice(device.name, seen.names);
}

/** The ways in, by Better Auth endpoint. `/callback/:id` and `/sign-in/social` name the provider instead. */
const SIGN_IN_VIA = {
  "/magic-link/verify": "link",
  "/sign-in/email-otp": "code",
  "/passkey/verify-authentication": "passkey",
};
const providerVia = (/** @type {any} */ id) => (["google", "apple"].includes(id) ? id : "unknown");
/** The endpoints that mail a sign-in link or code. */
const SENT_VIA = { "/sign-in/magic-link": "link", "/email-otp/send-verification-otp": "code" };
/** The session revocations, and which sessions each ends. */
const REVOKED = {
  "/revoke-session": "one",
  "/revoke-sessions": "all",
  "/revoke-other-sessions": "others",
};
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
  const code =
    typeof error.body?.code === "string"
      ? error.body.code
      : String(error.status ?? error.statusCode ?? "error");
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
 */
/** @import { AuthEvent } from "./sign-in-account.mjs" */

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
    return {
      event: OWASP_EVENTS.authorizationFailure,
      fields: { reason: result.code, endpoint: path, ...user },
      level: "warn",
    };
  }
  const via = Object.hasOwn(SIGN_IN_VIA, path)
    ? SIGN_IN_VIA[/** @type {keyof typeof SIGN_IN_VIA} */ (path)]
    : path === "/callback/:id"
      ? providerVia(params?.id)
      : path === "/sign-in/social" && body?.idToken
        ? providerVia(body.provider)
        : null;
  if (via) {
    if (signedIn) return { event: OWASP_EVENTS.signInSuccess, fields: { via, ...user } };
    if (result.ok) return null; // an OAuth callback that linked (told by the account hook), or a sign-in started
    if (linking)
      return {
        event: OWASP_EVENTS.userUpdated,
        fields: { change: "sign_in_linked", via, code: result.code },
        level: "warn",
      };
    return {
      event: OWASP_EVENTS.signInFailure,
      fields: { via, code: result.code },
      level: "warn",
      email: body?.email,
    };
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
      notice: {
        kind: "passkey-added",
        ...(typeof name === "string" && name ? { passkeyName: name } : {}),
      },
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
export async function logAuthEvent(
  { event, fields, level, email },
  { db, userAgent, request, deviceId } = {},
) {
  const key = typeof email === "string" ? await emailKey("email", email) : null;
  logEvent(event, { ...fields, ...(key ? { email_key: key } : {}) }, level ? { level } : {});
  if (db)
    await recordAuthEvent(db, {
      event,
      fields,
      userAgent: userAgent ?? request?.headers.get("user-agent"),
      request,
      deviceId,
    });
}

/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, all(): Promise<{ results: any[] }> } } }} D1Like
 */

/**
 * The migration a site that passes `eventsDb` adds as its next file under `migrations/`: one row per auth event, with
 * `at` in epoch ms, the OWASP `event`, the `change` or `scope` its line carries (a passkey's id for a passkey sign-in),
 * `via`, and the device and coarse place. No address, token or code. `user_id` is null before there is a user; those
 * rows are kept 30 days, a person's own a year (`pruneAuthEvents`).
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
export async function recordAuthEvent(
  db,
  { event, fields, userAgent, request, at = Date.now(), deviceId },
) {
  const text = (/** @type {unknown} */ value) =>
    typeof value === "string" && value ? value : null;
  const values = [
    at,
    event,
    text(fields.change) ?? text(fields.scope) ?? text(fields.passkey_id),
    text(fields.via),
    text(fields.user_id),
    deviceName(userAgent),
    coarseLocation(request),
  ];
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
 * @returns {Promise<SecurityHistoryEntry[]>}
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
    kind:
      row.event === OWASP_EVENTS.signInSuccess
        ? "sign-in"
        : HISTORY_KINDS[/** @type {keyof typeof HISTORY_KINDS} */ (row.change)],
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
    .prepare(
      `SELECT DISTINCT device FROM auth_events WHERE user_id = ?1 AND event = '${OWASP_EVENTS.signInSuccess}'`,
    )
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
    .prepare(
      `SELECT DISTINCT device_id FROM auth_events WHERE user_id = ?1 AND event = '${OWASP_EVENTS.signInSuccess}' AND device_id IS NOT NULL`,
    )
    .bind(userId)
    .all();
  return results.map((row) => String(row.device_id));
}

/** Whether a person's history shows a passkey added, so a sign-in with none left is a recovery. @param {D1Like} db @param {string} userId */
export async function hadPasskey(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT 1 FROM auth_events WHERE user_id = ?1 AND event = '${OWASP_EVENTS.userUpdated}' AND change = 'passkey_added' LIMIT 1`,
    )
    .bind(userId)
    .all();
  return results.length > 0;
}

/**
 * Whether the person has signed in before but never from this device. A first sign-in is no new device.
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
