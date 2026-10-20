/**
 * The one constant-time comparison of a presented secret with the expected one. Capsid (src/auth.ts) and
 * dustinedwards.info (app/lib/bearer.server.ts) each had their own until 2026-10-20; this is the one copy (2026-10-20).
 * A copy that drifts toward `===` leaks the secret a byte at a time and no test notices.
 *
 * - Both sides are hashed with SHA-256 first, so what is compared is always 32 bytes against 32 bytes. Comparing the
 *   strings themselves would leak their lengths through an early return or the loop bound; after hashing, neither
 *   length reaches the comparison. (The hash itself takes time in proportion to the input's length, which is the
 *   unavoidable part, and it is the attacker's own input whose length that reveals.)
 * - The bytes are compared by crypto.subtle.timingSafeEqual where the runtime has it (workerd; Cloudflare's Workers
 *   best-practices guide names it for secret compares), and by an XOR over all 32 bytes elsewhere (Node, the tests).
 * - A side that is not a string, or is empty, matches nothing, so an unset secret (`env.KEY` undefined, or "") never
 *   admits an absent or empty credential.
 */

/** @param {string} text */
async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * Two equal-length byte arrays, compared in time that does not depend on where they differ.
 * @param {Uint8Array<ArrayBuffer>} a
 * @param {Uint8Array<ArrayBuffer>} b
 */
function sameBytes(a, b) {
  const native = /** @type {{ timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean }} */ (crypto.subtle).timingSafeEqual;
  if (typeof native === "function") return native.call(crypto.subtle, a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * True when `a` and `b` are the same non-empty string, in time that does not depend on where they differ or on the
 * expected secret's length.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {Promise<boolean>}
 */
export async function safeEqual(a, b) {
  // Both digests are computed before either check is answered, so a refused type or empty side costs what a compare does.
  const valid = typeof a === "string" && typeof b === "string" && a !== "" && b !== "";
  const [left, right] = await Promise.all([digest(typeof a === "string" ? a : ""), digest(typeof b === "string" ? b : "")]);
  const same = sameBytes(left, right);
  return valid && same;
}
