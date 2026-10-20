/** The one constant-time secret comparison (compare.mjs). */
/**
 * True when `a` and `b` are the same non-empty string. Both are hashed with SHA-256 and the digests compared by
 * crypto.subtle.timingSafeEqual where the runtime has it, else by an XOR over all 32 bytes. A non-string or empty side
 * matches nothing.
 */
export function safeEqual(a: unknown, b: unknown): Promise<boolean>;
