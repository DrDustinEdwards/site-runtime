/** The same-origin check on a request that changes something, for routes no framework check covers (origin.mjs). */

/** "Cross-origin requests are not accepted." */
export const ORIGIN_REFUSAL: string;
/** An absent Origin passes, the same origin passes, anything else (the string "null" included) is refused. */
export function originVerdict(
  origin: string | null | undefined,
  requestUrl: string,
): { ok: boolean; reason: "absent" | "same-origin" | "cross-origin" | "unparseable-request-url" };
/** The 403 plain-text refusal, `no-store`, with `headers` added. */
export function originRefusal(headers?: Record<string, string>): Response;
/** Null when the request may go on (GET, HEAD, OPTIONS, or an Origin that passes), else the refusal. */
export function refuseCrossOrigin(request: Request, headers?: Record<string, string>): Response | null;
