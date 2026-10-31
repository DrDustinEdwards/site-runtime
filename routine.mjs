/**
 * Starting a Claude Code routine from a site: one POST to the routine's API trigger, which opens a session on Dustin's
 * Claude subscription. A site never holds a subscription credential (Anthropic allows subscription sign-in only in
 * Claude Code and its own apps, code.claude.com/docs/en/legal-and-compliance); the trigger token can start this one
 * routine and read nothing.
 *
 * Contract (platform.claude.com/docs/en/api/claude-code/routines-fire, read 2026-09-27, 2026-10-11 and 2026-10-30):
 * POST the fire URL with `Authorization: Bearer <token>` and `anthropic-version` (required; the beta header is optional
 * and still accepted), body `{ "text": ... }` of at most 65,536 characters. A 200 is
 * `{ "type": "routine_fire", "claude_code_session_id", "claude_code_session_url" }`. 400, 401, 403 and 404 will not work
 * until something changes; 429 is the hourly limit (30 per routine, 100 per account) with `Retry-After`; 500 and
 * 503 `overloaded_error` are worth a later try.
 *
 * - NO IDEMPOTENCY KEY. Every fire that reaches Anthropic is a new session, so a fire whose answer never came back is
 *   "unknown", not "retry": the session may exist. Only a connection that certainly never opened is safe to repeat.
 * - DUPLICATE GUARD. `fireOnce` records each fire under the caller's job key in a store the caller supplies, which must
 *   have an atomic `add` (D1, a Durable Object), and refuses a second fire for a key already fired or unknown, unless
 *   forced. Never KV: it is eventually consistent, so two fires from two locations both read nothing and both start.
 *   `d1FireStore(db)` is that store on a D1 table (ROUTINE_FIRES_SQL), so adopting the guard is one migration and one
 *   call: `fireOnce(d1FireStore(env.DB), jobKey, config, text)`.
 * - NO CALLER-SIDE THROTTLE (R4, kept on purpose). The limits are 30 fires an hour per routine and 100 per account, and
 *   one routine and one account serve several callers (Capsid's namespaces, Carrel, germomics), so no caller's own count
 *   can know the real one: it would refuse fires Anthropic allows, or allow ones it refuses. Anthropic's count is the
 *   only true one, and its 429 is cheap, starts no session and says when (`retryAfter`); `fireOnce` frees the job key on
 *   it, so the job waits for the caller's next tick instead of being lost.
 */

const FIRE_URL = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/(trig_[A-Za-z0-9_-]{8,64})\/fire$/;
const MAX_TEXT = 65_536;
const TIMEOUT_MS = 15_000;
const ANSWER_MAX_CHARS = 64 * 1024;

// What a session answer may name. The id's charset is wider than the documented example because a real answer failed
// the strict one (capsid, job_a7d6f6009242).
const SESSION_SEGMENT = /^session_[A-Za-z0-9_-]{8,128}$/;
const SESSION_URL = /^https:\/\/(?:[a-z0-9-]+\.)*claude\.ai(?:\/[A-Za-z0-9_.-]+)*\/session_[A-Za-z0-9_-]{8,128}\/?$/;

// Error codes Node's fetch gives when no connection was made, so nothing reached Anthropic. Anything else (a timeout,
// a reset, a Workers "Network connection lost") may have followed the request and is unknown.
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

export function routineId(url) {
  return typeof url === "string" ? (FIRE_URL.exec(url.trim())?.[1] ?? null) : null;
}

export function routineConfig(url, token) {
  const u = typeof url === "string" ? url.trim() : "";
  const t = typeof token === "string" ? token.trim() : "";
  if (!u || !t) return { missing: "The routine's fire URL and token are not both set." };
  const id = routineId(u);
  if (!id) return { missing: "The routine URL is not a /fire URL (https://api.anthropic.com/v1/claude_code/routines/trig_.../fire)." };
  return { url: u, token: t, routineId: id };
}

export async function fireRoutine(config, text, fetcher = fetch) {
  let res;
  try {
    res = await fetcher(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: String(text).slice(0, MAX_TEXT) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error?.cause?.code ?? error?.code;
    if (NOT_SENT.has(code)) return { ok: false, outcome: "unreachable", retry: true, error: `The routine could not be reached (${code}).` };
    return { ok: false, outcome: "unknown", retry: false, error: `No answer from the routine (${message.slice(0, 200)}); a session may have started.` };
  }
  if (res.ok) return readAnswer(res);
  const type = await errorType(res);
  const error = `${res.status}${type ? ` ${type}` : ""}`;
  if (res.status === 429) return withRetryAfter({ ok: false, outcome: "rate_limited", retry: true, status: 429, error }, res);
  if (res.status >= 500) return withRetryAfter({ ok: false, outcome: "unavailable", retry: true, status: res.status, error }, res);
  return { ok: false, outcome: "refused", retry: false, status: res.status, error };
}

// A 2xx means a session was created. It counts as started only when the answer is a routine_fire naming a session;
// otherwise it is unknown, never a reason to fire again.
async function readAnswer(res) {
  const text = (await res.text().catch(() => "")).slice(0, ANSWER_MAX_CHARS);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const answer = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
  const session = answer.type === "routine_fire" ? readSession(answer) : null;
  if (session) return { ok: true, outcome: "started", status: res.status, ...session };
  const keys = Object.keys(answer).slice(0, 10).map((k) => k.replace(/[^A-Za-z0-9_]/g, "?").slice(0, 40));
  return { ok: false, outcome: "unknown", retry: false, status: res.status, error: `${res.status} but the answer names no session (keys: ${keys.join(", ") || "none"}); a session may have started.` };
}

// The id and the URL each stand alone: either one is enough, the other is derived, and when both read but disagree
// the id is trusted.
function readSession(answer) {
  const named = (url) => url.split("/").find((s) => SESSION_SEGMENT.test(s)) ?? null;
  let id = typeof answer.claude_code_session_id === "string" && SESSION_SEGMENT.test(answer.claude_code_session_id) ? answer.claude_code_session_id : null;
  let url = readSessionUrl(answer.claude_code_session_url);
  if (id === null && url !== null) id = named(url);
  if (id === null) return null;
  if (url === null || named(url) !== id) url = `https://claude.ai/code/${id}`;
  return { sessionId: id, sessionUrl: url };
}

// A claude.ai session URL reduced to origin and path, or null.
function readSessionUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  const clean = `https://${url.hostname}${url.pathname}`;
  return SESSION_URL.test(clean) ? clean : null;
}

async function errorType(res) {
  const body = await res.json().catch(() => null);
  const type = body?.error?.type;
  return typeof type === "string" && /^[a-z_]{1,64}$/.test(type) ? type : "";
}

// Retry-After as whole seconds: delta-seconds or an HTTP date (RFC 9110, 10.2.3). Absent or unreadable, it is left off.
function withRetryAfter(result, res) {
  const raw = res.headers.get("Retry-After")?.trim() ?? "";
  let seconds = null;
  if (/^\d{1,9}$/.test(raw)) seconds = Number(raw);
  else if (raw && Number.isFinite(Date.parse(raw))) seconds = Math.max(0, Math.ceil((Date.parse(raw) - Date.now()) / 1000));
  return seconds === null ? result : { ...result, retryAfter: seconds };
}

// ---------- The duplicate guard

/** The table `d1FireStore` keeps its records in, as a migration creates it. */
export const ROUTINE_FIRES_SQL = "CREATE TABLE IF NOT EXISTS routine_fires (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

/**
 * `fireOnce`'s store on a D1 table (default `routine_fires`, ROUTINE_FIRES_SQL). `add` is one INSERT ... ON CONFLICT DO
 * NOTHING RETURNING, which D1 runs atomically, so two fires at once cannot both reserve the key.
 * @param {{ prepare(sql: string): { bind(...values: unknown[]): { first(): Promise<any>; run(): Promise<unknown> } } }} db
 * @param {string} [table]
 */
export function d1FireStore(db, table = "routine_fires") {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(table)) throw new TypeError(`${table} is not a table name`);
  const run = (/** @type {string} */ sql, /** @type {unknown[]} */ ...values) => db.prepare(sql).bind(...values);
  return {
    get: async (/** @type {string} */ key) => (await run(`SELECT value FROM ${table} WHERE key = ?1`, key).first())?.value ?? null,
    put: (/** @type {string} */ key, /** @type {string} */ value) =>
      run(`INSERT INTO ${table} (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value).run(),
    delete: (/** @type {string} */ key) => run(`DELETE FROM ${table} WHERE key = ?1`, key).run(),
    add: async (/** @type {string} */ key, /** @type {string} */ value) =>
      (await run(`INSERT INTO ${table} (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING RETURNING key`, key, value).first()) != null,
  };
}

const readRecord = (raw) => {
  try {
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    return record && typeof record === "object" && typeof record.state === "string" ? record : null;
  } catch {
    return { state: "unknown", at: "" };
  }
};

// A reservation older than this was left by a worker that died mid-fire: reported as unknown, not in flight.
const FIRING_STALE_MS = 10 * 60_000;

export async function fireOnce(store, jobKey, config, text, options = {}) {
  if (typeof store?.add !== "function") {
    throw new TypeError("fireOnce needs a store with an atomic add (D1 or a Durable Object); KV's get then put lets two fires through");
  }
  const { fetcher = fetch, force = false, refireAfterMs = Infinity, now = new Date() } = options;
  const key = `routine-fire:${jobKey}`;
  const age = (record) => now.getTime() - Date.parse(record.at);
  // A `failed` record is a sure non-start whose delete failed: it holds nothing.
  const blocks = (record) => record !== null && record.state !== "failed" && !force && !(age(record) >= refireAfterMs);
  // Reserve before posting, so a second caller sees "firing" and stays out; `add` lets only one caller reserve.
  const reservation = JSON.stringify({ state: "firing", at: now.toISOString() });
  if (!(await store.add(key, reservation))) {
    let earlier = readRecord(await store.get(key));
    if (blocks(earlier)) {
      if (earlier.state === "firing" && !(age(earlier) < FIRING_STALE_MS)) earlier = { ...earlier, state: "unknown", error: "the fire never finished; a session may have started" };
      const at = earlier.at ? ` at ${earlier.at}` : "";
      return { ok: false, outcome: "already_fired", retry: false, record: earlier, error: `${jobKey} was already fired${at} (${earlier.state}${earlier.sessionUrl ? `, ${earlier.sessionUrl}` : ""}); each fire is a new session.` };
    }
    await store.put(key, reservation);
  }
  const fired = await fireRoutine(config, text, fetcher);
  // A fire that certainly started nothing frees the key (or, when the delete fails, marks it `failed`); a session, or a
  // fire that may have made one, holds it. A failed write still returns the session.
  try {
    if (fired.ok) await store.put(key, JSON.stringify({ state: "fired", at: now.toISOString(), sessionId: fired.sessionId, sessionUrl: fired.sessionUrl }));
    else if (fired.outcome === "unknown") await store.put(key, JSON.stringify({ state: "unknown", at: now.toISOString(), error: fired.error }));
    else await store.delete(key).catch(() => store.put(key, JSON.stringify({ state: "failed", at: now.toISOString(), error: fired.error })));
  } catch (error) {
    return { ...fired, unrecorded: error instanceof Error ? error.message : String(error) };
  }
  return fired;
}
