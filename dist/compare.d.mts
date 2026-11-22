/**
 * True when `a` and `b` are the same non-empty string, in time that does not depend on where they differ or on the
 * expected secret's length.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {Promise<boolean>}
 */
export function safeEqual(a: unknown, b: unknown): Promise<boolean>;
