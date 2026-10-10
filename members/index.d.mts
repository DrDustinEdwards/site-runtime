export type TitleSpec = { id: string; label: string; layer: 2 | 3; permissions: string[]; expires: boolean };
export type Title = { id: string; label: string; layer: 0 | 1 | 2 | 3; permissions: string[]; expires: boolean };
export type Catalog = { permissions: string[]; titles: Map<string, Title> };
export type MemberRow = { email: string; name?: string; title: string; end_date: string | null; status: "active" | "removed" | "expired" };
export type Actor = { email: string; title: string; layer: number; permissions: Set<string> };
export type Verdict = { ok: true } | { ok: false; reason: string };
export type Change =
  | { kind: "add"; email: string; title: string; end_date: string | null }
  | { kind: "change_title"; target: MemberRow; title: string; reason: string }
  | { kind: "renew"; target: MemberRow }
  | { kind: "remove"; target: MemberRow };
export type AuditRow = {
  at: string;
  actor: string;
  actor_title: string;
  action: "add" | "change_title" | "renew" | "remove" | "expire";
  member_email: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  cloudflare: "pending";
};

export const PRIMARY_OWNER: "primary_owner";
export const OWNER: "owner";
export const MANAGE_MEMBERS: "manage_members";
/** How long before an end date a lead's review opens (three weeks). */
export const REVIEW_DAYS: 21;

/** Lower-cased and trimmed, the form every comparison and every stored row uses. */
export function normalizeEmail(email: string): string;
/** An app's titles, checked once at startup. The two owner titles are added here and cannot be redefined. */
export function defineTitles(spec: { permissions: string[]; titles: TitleSpec[] }): Catalog;
/** Whether a row's end date has passed. A row is valid through the whole of its end date, in UTC. */
export function isExpired(row: MemberRow, nowMs: number): boolean;
/** Whether the lead's "still on your team?" review is open for this row (three weeks before its end date). */
export function reviewOpen(row: MemberRow, nowMs: number): boolean;
/** Who is asking: the Primary Owner from configuration, or an active, unexpired row. Null means no access. */
export function resolveActor(
  email: string,
  row: MemberRow | null | undefined,
  context: { catalog: Catalog; primaryOwnerEmail: string; nowMs: number },
): Actor | null;
/** Whether the actor holds a permission. The only question a handler asks. */
export function can(actor: Actor | null, permission: string): boolean;
/** The first term end after today (or after `after`, to renew), or null for a title that does not expire. */
export function defaultEndDate(title: Title, termEnds: string[], nowMs: number, after?: string | null): string | null;
/** Whether `actor` may make `change`, under both rules: below your own layer, nothing you do not hold. */
export function checkChange(
  actor: Actor | null,
  change: Change,
  context: { catalog: Catalog; primaryOwnerEmail: string; termEnds: string[]; nowMs: number },
): Verdict;
/** The member_audit row for a change; `cloudflare` starts "pending" until the sync answers. */
export function auditRow(entry: {
  actor: Actor;
  action: AuditRow["action"];
  email: string;
  before: MemberRow | null;
  after: MemberRow | null;
  reason?: string;
  nowMs: number;
}): AuditRow;
/** The emails that belong on the app's Access allow list: every active, unexpired row, sorted. */
export function allowList(rows: MemberRow[], nowMs: number): string[];
