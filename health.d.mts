/**
 * The /health response (health.mjs), in the IETF health check draft's shape: `application/health+json`,
 * `{ status, ok, alerts?, db?, backup?, sha?, time, checks }`, no-store and noindex. 503 only when a "fail" check failed; a
 * failed "warn" check (the backup's warning among them) is status "warn" and 200. `ok` is `status !== "fail"`. `alerts`
 * names the failed checks marked `alert` (each also `alert: true` in `checks`), for a watcher to mail on. Each check is
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
  /** A failure someone should hear of now: the result carries `alert: true` and the body's `alerts` names it. */
  alert?: boolean;
  run: () => Promise<unknown>;
}

/** One check in the body: its detail is scrubbed and cut to 200 characters. */
export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
  /** Only on a failed alert check. */
  alert?: true;
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
/**
 * The sign-in spike alert (F3), level warn and `alert: true`: fails when failed sign-ins or sign-in mails in the last `windowMinutes`
 * (60) pass `failures` (50) or `mails` (50), read from ./sign-in's `auth_events` table (AUTH_EVENTS_SQL, `eventsDb`).
 */
export function authSpikeCheck(
  db: import("./sign-in-account.mjs").D1Like,
  limits?: { windowMinutes?: number; failures?: number; mails?: number; now?: () => number },
): HealthCheck;
/** The Images binding answers `info` on a 1 x 1 GIF (reads the header, transforms nothing). Level warn. */
export function imagesCheck(name: string, images: { info(stream: ReadableStream<Uint8Array>): Promise<unknown> }): HealthCheck;
/** A Durable Object namespace is bound and mints an id (`idFromName`); no object is woken. Level warn. */
export function durableObjectCheck(name: string, namespace: { idFromName(name: string): unknown } | undefined): HealthCheck;
/** A Queue producer binding is present; nothing is sent. Level warn. */
export function queueCheck(name: string, queue: { send(message: unknown): Promise<unknown> } | undefined): HealthCheck;
/** The Workers AI binding is present; no model is run (every call is billed). Level warn. */
export function aiCheck(name: string, ai: { run(...args: any[]): Promise<unknown> } | undefined): HealthCheck;
