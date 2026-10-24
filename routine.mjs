/**
 * Starting a Claude Code routine from a site: one POST to the routine's API trigger, which opens a session on Dustin's
 * Claude subscription. A site never holds a subscription credential (Anthropic allows subscription sign-in only in
 * Claude Code and its own apps, code.claude.com/docs/en/legal-and-compliance); the trigger token can start this one
 * routine and read nothing.
 *
 * Contract (platform.claude.com/docs/en/api/claude-code/routines-fire, read 2026-09-27 and 2026-10-11): POST the fire
 * URL with `Authorization: Bearer <token>` and `anthropic-version: 2023-06-01`, body `{ "text": ... }` of at most
 * 65,536 characters; a 2xx names the session; 429 is the hourly limit (30 per routine, 100 per account).
 */

const FIRE_URL = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]{8,64}\/fire$/;
const MAX_TEXT = 65_536;
const TIMEOUT_MS = 15_000;

export function routineConfig(url, token) {
  const u = typeof url === "string" ? url.trim() : "";
  const t = typeof token === "string" ? token.trim() : "";
  if (!u || !t) return { missing: "The routine's fire URL and token are not both set." };
  if (!FIRE_URL.test(u)) return { missing: "The routine URL is not a /fire URL (https://api.anthropic.com/v1/claude_code/routines/trig_.../fire)." };
  return { url: u, token: t };
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
    return { ok: false, retry: true, error: `The routine could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (res.ok) {
    const body = await res.json().catch(() => ({}));
    const url = typeof body?.claude_code_session_url === "string" ? body.claude_code_session_url : "";
    return { ok: true, sessionUrl: /^https:\/\/([a-z0-9-]+\.)*claude\.ai\//.test(url) ? url : "" };
  }
  const body = await res.json().catch(() => ({}));
  const type = typeof body?.error?.type === "string" ? body.error.type.slice(0, 64) : "";
  const error = `${res.status}${type ? ` ${type}` : ""}`;
  return { ok: false, retry: res.status === 429 || res.status >= 500, error };
}
