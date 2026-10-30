/**
 * The /health response (health.mjs), in the IETF health check draft's shape: `application/health+json`,
 * `{ status, ok, db?, backup?, sha?, time, checks }`, no-store and noindex. 503 only when a "fail" check failed; a failed
 * "warn" check (the backup's warning among them) is status "warn" and 200. `ok` is `status === "pass"`. Each check is
 * raced against `checkTimeoutMs` (default 3000). The backup read is held per isolate for `backupTtlMs` (default 5 minutes).
 */

/** The longest `detail` a check reports: 200. */
export const CHECK_DETAIL_MAX: number;

/**
 * One check. It fails when `run` throws, rejects, times out, resolves `false` or resolves `{ ok: false, detail? }`.
 * `level` defaults to "fail".
 */
export interface HealthCheck {
  name: string;
  level?: "fail" | "warn";
  run: () => Promise<unknown>;
}

/** One check in the body: its detail is scrubbed and cut to 200 characters. */
export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
}

/** `ping` becomes check "db" (level fail); a backup status with `warning` fails check "backup" (level warn). */
export function healthResponse(probe?: {
  ping?: () => Promise<unknown>;
  backup?: () => Promise<unknown>;
  sha?: string;
  checks?: HealthCheck[];
  backupTtlMs?: number;
  checkTimeoutMs?: number;
  now?: Date;
}): Promise<Response>;

/** A check that an R2 bucket answers: a `head` of a fixed key; null passes, a throw fails. */
export function r2Check(name: string, bucket: { head(key: string): Promise<unknown> }): HealthCheck;
/** A check that a KV namespace answers: a `get` of a fixed key; null passes, a throw fails. */
export function kvCheck(name: string, kv: { get(key: string): Promise<unknown> }): HealthCheck;
