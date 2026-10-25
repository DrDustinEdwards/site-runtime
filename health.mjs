/**
 * The /health response for uptime monitors and the Capsid console: 200 when the database answers `ping`, 503 when it
 * throws. Unauthenticated, so the body carries only up or down, the backup's status, the deployed commit when given and
 * the time. Never cached, never indexed.
 *
 * `ok` is true only when the database is up and the backup has no warning, so a monitor reading `ok` sees a stale dump.
 * A stale dump still answers 200: the site is up.
 *
 * The backup read is held per isolate for `backupTtlMs` (five minutes by default). Reading it lists an R2 bucket, which
 * R2 bills as a Class A operation, and this route is public and uncached; the dump runs once a day, so an answer five
 * minutes old loses nothing.
 */

/** @type {{ at: number, value: unknown } | null} */
let held = null;

/**
 * @param {{ ping: () => Promise<unknown>, backup: () => Promise<unknown>, sha?: string, backupTtlMs?: number, now?: Date }} probe
 * @returns {Promise<Response>}
 */
export async function healthResponse({ ping, backup, sha, backupTtlMs = 5 * 60_000, now = new Date() }) {
  let up = false;
  try {
    await ping();
    up = true;
  } catch (err) {
    console.error(JSON.stringify({ event: "health_db_down", error: String(err) }));
  }
  const at = now.getTime();
  if (!held || at - held.at >= backupTtlMs || at < held.at) held = { at, value: await backup() };
  const status = held.value;
  const warned = Boolean(status && typeof status === "object" && "warning" in status && status.warning);
  const body = { ok: up && !warned, db: up ? "up" : "down", backup: status, ...(sha ? { sha } : {}), time: now.toISOString() };
  return new Response(JSON.stringify(body), {
    status: up ? 200 : 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
