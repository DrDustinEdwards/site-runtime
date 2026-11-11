/** /health's verdict in KV for a page's tile (health-snapshot.mjs): one writer, the site's scheduled job. */

export interface SnapshotCheck {
  name: string;
  status: "pass" | "warn" | "fail";
}
export interface HealthSnapshot {
  ok: boolean;
  total: number;
  failed: number;
  readAt: string;
  checks: SnapshotCheck[];
}
export type HealthTile =
  | ({ state: "fresh" | "stale"; ageSeconds: number } & HealthSnapshot)
  | { state: "missing" }
  | { state: "unreadable" };
export const HEALTH_SNAPSHOT_KEY: string;
export const HEALTH_SNAPSHOT_EVERY_MINUTES: number;
/** The tile from a stored value; "missing" for anything uncertain, "stale" after three intervals. */
export function healthTile(
  snapshot: unknown,
  nowMs: number,
  options?: { everyMinutes?: number },
): HealthTile;
/** An age in words, minutes at the finest. */
export function formatAge(ageSeconds: number): string;
/** Each check's name and status from a /health body, or null when it is not one. */
export function snapshotFromBody(body: unknown, readAt: string): HealthSnapshot | null;
/** Run the site's /health answer and store the snapshot; throws when nothing was stored. */
export function storeHealthSnapshot(options: {
  kv: KVNamespace;
  answer: () => Promise<Response>;
  now?: Date;
  key?: string;
}): Promise<void>;
/** The tile for a page; a failed read is "unreadable". */
export function readHealthTile(options: {
  kv: KVNamespace;
  now?: number;
  everyMinutes?: number;
  key?: string;
}): Promise<HealthTile>;
