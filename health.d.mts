/**
 * The /health response (health.mjs): 200 or 503 on `ping`, `{ ok, db, backup, sha?, time }`, no-store and noindex. `ok`
 * is false when the backup carries a warning. The backup read is held per isolate for `backupTtlMs` (default 5 minutes).
 */
export function healthResponse(probe: {
  ping: () => Promise<unknown>;
  backup: () => Promise<unknown>;
  sha?: string;
  backupTtlMs?: number;
  now?: Date;
}): Promise<Response>;
