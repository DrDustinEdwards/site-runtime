/** Lower-cased and trimmed, the form every comparison and every stored row uses. @param {string} email */
export function normalizeEmail(email: string): string;
/**
 * An app's titles, checked once at startup. `permissions` is every permission the app defines;
 * `manage_members` is always among them. The two owner titles are added here and cannot be redefined.
 * @param {{ permissions: string[], titles: TitleSpec[] }} spec
 * @returns {Catalog}
 */
export function defineTitles({ permissions, titles }: {
    permissions: string[];
    titles: TitleSpec[];
}): Catalog;
/** Whether a row's end date has passed at `nowMs`. A null end date never passes. @param {MemberRow} row @param {number} nowMs */
export function isExpired(row: MemberRow, nowMs: number): boolean;
/** Whether the lead's "still on your team?" review is open for this row. @param {MemberRow} row @param {number} nowMs */
export function reviewOpen(row: MemberRow, nowMs: number): boolean;
/**
 * Who is asking. The Primary Owner comes from deployment configuration and has no row; anyone else needs an
 * active, unexpired row with a title the app defines. Read the row on every request, uncached, so a removal
 * or an expiry takes effect on the next click. Returns null for a person with no access.
 * @param {string} email the verified Access email
 * @param {MemberRow | null | undefined} row this email's row, if any
 * @param {{ catalog: Catalog, primaryOwnerEmail: string, nowMs: number }} context
 * @returns {Actor | null}
 */
export function resolveActor(email: string, row: MemberRow | null | undefined, { catalog, primaryOwnerEmail, nowMs }: {
    catalog: Catalog;
    primaryOwnerEmail: string;
    nowMs: number;
}): Actor | null;
/** Whether the actor holds a permission. The only question a handler asks. @param {Actor | null} actor @param {string} permission */
export function can(actor: Actor | null, permission: string): boolean;
/**
 * The end date a title gets by default: the first of the app's term end dates after today. Titles that do
 * not expire get null. Refuses when the Owner has not entered a future term end yet, so no row is written
 * with an invented date.
 * @param {Title} title
 * @param {string[]} termEnds the app's semester or term end dates, entered once a year by an Owner
 * @param {number} nowMs
 * @param {string | null} [after] renew: the row's current end date, so the next term is the one after it
 */
export function defaultEndDate(title: Title, termEnds: string[], nowMs: number, after?: string | null): string | null;
/**
 * Whether `actor` may make `change`. Every rule is here, so the members page, its API and any agent
 * acting for an app ask the same function.
 *   add           { kind: "add", email, title, end_date }
 *   change_title  { kind: "change_title", target, title, reason }
 *   renew         { kind: "renew", target }
 *   remove        { kind: "remove", target }
 * `target` is the person's current row. The Primary Owner has no row, so nothing can remove or demote them.
 * @param {Actor | null} actor
 * @param {{ kind: "add" | "change_title" | "renew" | "remove", email?: string, title?: string, end_date?: string | null, target?: MemberRow, reason?: string }} change
 * @param {{ catalog: Catalog, primaryOwnerEmail: string, termEnds: string[], nowMs: number }} context
 * @returns {Verdict}
 */
export function checkChange(actor: Actor | null, change: {
    kind: "add" | "change_title" | "renew" | "remove";
    email?: string;
    title?: string;
    end_date?: string | null;
    target?: MemberRow;
    reason?: string;
}, { catalog, primaryOwnerEmail, termEnds, nowMs }: {
    catalog: Catalog;
    primaryOwnerEmail: string;
    termEnds: string[];
    nowMs: number;
}): Verdict;
/**
 * The `member_audit` row for a change, written in the same batch as the member row. `cloudflare` starts
 * "pending" and the sync's answer updates it, so a failed sync shows and is retried, never ignored.
 * @param {{ actor: Actor, action: "add" | "change_title" | "renew" | "remove" | "expire", email: string, before: MemberRow | null, after: MemberRow | null, reason?: string, nowMs: number }} entry
 * @returns {AuditRow}
 */
export function auditRow({ actor, action, email, before, after, reason, nowMs }: {
    actor: Actor;
    action: "add" | "change_title" | "renew" | "remove" | "expire";
    email: string;
    before: MemberRow | null;
    after: MemberRow | null;
    reason?: string;
    nowMs: number;
}): AuditRow;
/**
 * The emails that belong on the app's Access allow list: every active, unexpired row whose title the app defines,
 * the same rows resolveActor admits. The Primary Owner is not on it; admin surfaces list Dustin's emails directly in
 * their own policies.
 * @param {MemberRow[]} rows
 * @param {number} nowMs
 * @param {Catalog} catalog
 */
export function allowList(rows: MemberRow[], nowMs: number, catalog: Catalog): string[];
/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md). Each app keeps its own `members` and `member_audit` tables and its own
 * titles; this module holds the rules every app shares, so they are tested once.
 *
 * Code checks permissions, never titles. A title is a named bundle of permissions on a layer:
 *   0  primary_owner  Dustin only, from deployment configuration (PRIMARY_OWNER_EMAIL), never a row
 *   1  owner          set on the members page by the Primary Owner only
 *   2  leads          set by layers 0 and 1
 *   3  members        set by layers 0 to 2
 * Two rules decide every change: you manage only people below your own layer, and you grant nothing you
 * do not hold. Owners and the Primary Owner hold every permission the app defines and never expire.
 *
 * Pure functions, no I/O, no dependencies. Dates are ISO calendar dates (YYYY-MM-DD) in UTC; a row is
 * valid through the whole of its end date and expired from the next day.
 *
 * @typedef {{ id: string, label: string, layer: 2 | 3, permissions: string[], expires: boolean }} TitleSpec
 * @typedef {{ id: string, label: string, layer: 0 | 1 | 2 | 3, permissions: string[], expires: boolean }} Title
 * @typedef {{ permissions: string[], titles: Map<string, Title> }} Catalog
 * @typedef {{ email: string, name?: string, title: string, end_date: string | null, status: "active" | "removed" | "expired" }} MemberRow
 * @typedef {{ email: string, title: string, layer: number, permissions: Set<string> }} Actor
 * @typedef {{ ok: true } | { ok: false, reason: string }} Verdict
 */
/**
 * @typedef {| { kind: "add"; email: string; title: string; end_date: string | null }
 * | { kind: "change_title"; target: MemberRow; title: string; reason: string }
 * | { kind: "renew"; target: MemberRow }
 * | { kind: "remove"; target: MemberRow }} Change
 */
/**
 * @typedef {object} AuditRow
 * @property {string} at
 * @property {string} actor
 * @property {string} actor_title
 * @property {"add" | "change_title" | "renew" | "remove" | "expire"} action
 * @property {string} member_email
 * @property {string | null} before
 * @property {string | null} after
 * @property {string | null} reason
 * @property {"pending"} cloudflare
 */
export const PRIMARY_OWNER: "primary_owner";
export const OWNER: "owner";
export const MANAGE_MEMBERS: "manage_members";
/** How long before an end date a lead's review opens (ruling 5: three weeks). */
export const REVIEW_DAYS: 21;
/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md). Each app keeps its own `members` and `member_audit` tables and its own
 * titles; this module holds the rules every app shares, so they are tested once.
 *
 * Code checks permissions, never titles. A title is a named bundle of permissions on a layer:
 *   0  primary_owner  Dustin only, from deployment configuration (PRIMARY_OWNER_EMAIL), never a row
 *   1  owner          set on the members page by the Primary Owner only
 *   2  leads          set by layers 0 and 1
 *   3  members        set by layers 0 to 2
 * Two rules decide every change: you manage only people below your own layer, and you grant nothing you
 * do not hold. Owners and the Primary Owner hold every permission the app defines and never expire.
 *
 * Pure functions, no I/O, no dependencies. Dates are ISO calendar dates (YYYY-MM-DD) in UTC; a row is
 * valid through the whole of its end date and expired from the next day.
 */
export type TitleSpec = {
    id: string;
    label: string;
    layer: 2 | 3;
    permissions: string[];
    expires: boolean;
};
/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md). Each app keeps its own `members` and `member_audit` tables and its own
 * titles; this module holds the rules every app shares, so they are tested once.
 *
 * Code checks permissions, never titles. A title is a named bundle of permissions on a layer:
 *   0  primary_owner  Dustin only, from deployment configuration (PRIMARY_OWNER_EMAIL), never a row
 *   1  owner          set on the members page by the Primary Owner only
 *   2  leads          set by layers 0 and 1
 *   3  members        set by layers 0 to 2
 * Two rules decide every change: you manage only people below your own layer, and you grant nothing you
 * do not hold. Owners and the Primary Owner hold every permission the app defines and never expire.
 *
 * Pure functions, no I/O, no dependencies. Dates are ISO calendar dates (YYYY-MM-DD) in UTC; a row is
 * valid through the whole of its end date and expired from the next day.
 */
export type Title = {
    id: string;
    label: string;
    layer: 0 | 1 | 2 | 3;
    permissions: string[];
    expires: boolean;
};
/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md). Each app keeps its own `members` and `member_audit` tables and its own
 * titles; this module holds the rules every app shares, so they are tested once.
 *
 * Code checks permissions, never titles. A title is a named bundle of permissions on a layer:
 *   0  primary_owner  Dustin only, from deployment configuration (PRIMARY_OWNER_EMAIL), never a row
 *   1  owner          set on the members page by the Primary Owner only
 *   2  leads          set by layers 0 and 1
 *   3  members        set by layers 0 to 2
 * Two rules decide every change: you manage only people below your own layer, and you grant nothing you
 * do not hold. Owners and the Primary Owner hold every permission the app defines and never expire.
 *
 * Pure functions, no I/O, no dependencies. Dates are ISO calendar dates (YYYY-MM-DD) in UTC; a row is
 * valid through the whole of its end date and expired from the next day.
 */
export type Catalog = {
    permissions: string[];
    titles: Map<string, Title>;
};
/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md). Each app keeps its own `members` and `member_audit` tables and its own
 * titles; this module holds the rules every app shares, so they are tested once.
 *
 * Code checks permissions, never titles. A title is a named bundle of permissions on a layer:
 *   0  primary_owner  Dustin only, from deployment configuration (PRIMARY_OWNER_EMAIL), never a row
 *   1  owner          set on the members page by the Primary Owner only
 *   2  leads          set by layers 0 and 1
 *   3  members        set by layers 0 to 2
 * Two rules decide every change: you manage only people below your own layer, and you grant nothing you
 * do not hold. Owners and the Primary Owner hold every permission the app defines and never expire.
 *
 * Pure functions, no I/O, no dependencies. Dates are ISO calendar dates (YYYY-MM-DD) in UTC; a row is
 * valid through the whole of its end date and expired from the next day.
 */
export type MemberRow = {
    email: string;
    name?: string;
    title: string;
    end_date: string | null;
    status: "active" | "removed" | "expired";
};
/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md). Each app keeps its own `members` and `member_audit` tables and its own
 * titles; this module holds the rules every app shares, so they are tested once.
 *
 * Code checks permissions, never titles. A title is a named bundle of permissions on a layer:
 *   0  primary_owner  Dustin only, from deployment configuration (PRIMARY_OWNER_EMAIL), never a row
 *   1  owner          set on the members page by the Primary Owner only
 *   2  leads          set by layers 0 and 1
 *   3  members        set by layers 0 to 2
 * Two rules decide every change: you manage only people below your own layer, and you grant nothing you
 * do not hold. Owners and the Primary Owner hold every permission the app defines and never expire.
 *
 * Pure functions, no I/O, no dependencies. Dates are ISO calendar dates (YYYY-MM-DD) in UTC; a row is
 * valid through the whole of its end date and expired from the next day.
 */
export type Actor = {
    email: string;
    title: string;
    layer: number;
    permissions: Set<string>;
};
/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md). Each app keeps its own `members` and `member_audit` tables and its own
 * titles; this module holds the rules every app shares, so they are tested once.
 *
 * Code checks permissions, never titles. A title is a named bundle of permissions on a layer:
 *   0  primary_owner  Dustin only, from deployment configuration (PRIMARY_OWNER_EMAIL), never a row
 *   1  owner          set on the members page by the Primary Owner only
 *   2  leads          set by layers 0 and 1
 *   3  members        set by layers 0 to 2
 * Two rules decide every change: you manage only people below your own layer, and you grant nothing you
 * do not hold. Owners and the Primary Owner hold every permission the app defines and never expire.
 *
 * Pure functions, no I/O, no dependencies. Dates are ISO calendar dates (YYYY-MM-DD) in UTC; a row is
 * valid through the whole of its end date and expired from the next day.
 */
export type Verdict = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export type Change = {
    kind: "add";
    email: string;
    title: string;
    end_date: string | null;
} | {
    kind: "change_title";
    target: MemberRow;
    title: string;
    reason: string;
} | {
    kind: "renew";
    target: MemberRow;
} | {
    kind: "remove";
    target: MemberRow;
};
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
