/**
 * The /health response for uptime monitors and the Capsid console: 200 when the database answers `ping`, 503 when it
 * throws. Unauthenticated, so the body carries only up or down, the backup's status (a stale dump is a warning inside
 * it, never a 503: the site is still up) and the time. Never cached, never indexed.
 *
 * @param {{ ping: () => Promise<unknown>, backup: () => Promise<unknown>, now?: Date }} probe
 * @returns {Promise<Response>}
 */
export async function healthResponse({ ping, backup, now = new Date() }) {
  let up = false;
  try {
    await ping();
    up = true;
  } catch (err) {
    console.error(JSON.stringify({ event: "health_db_down", error: String(err) }));
  }
  const body = { ok: up, db: up ? "up" : "down", backup: await backup(), time: now.toISOString() };
  return new Response(JSON.stringify(body), {
    status: up ? 200 : 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
