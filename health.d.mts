/** The /health response (health.mjs): 200 or 503 on `ping`, `{ ok, db, backup, time }`, no-store and noindex. */
export function healthResponse(probe: { ping: () => Promise<unknown>; backup: () => Promise<unknown>; now?: Date }): Promise<Response>;
