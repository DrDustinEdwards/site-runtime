/**
 * People and roles for an app with staff (capsid docs/design/design-identity-roles.md; Dustin's rulings of
 * 2026-10-09 in capsid/decisions.md). Each app keeps its own `members` and `member_audit` tables and its own
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

export const PRIMARY_OWNER = "primary_owner";
export const OWNER = "owner";
export const MANAGE_MEMBERS = "manage_members";
/** How long before an end date a lead's review opens (ruling 5: three weeks). */
export const REVIEW_DAYS = 21;

const DAY_MS = 86_400_000;
const ID = /^[a-z][a-z0-9_]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lower-cased and trimmed, the form every comparison and every stored row uses. @param {string} email */
export function normalizeEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) throw new TypeError(`not an email: ${email}`);
  return email.trim().toLowerCase();
}

/**
 * An app's titles, checked once at startup. `permissions` is every permission the app defines;
 * `manage_members` is always among them. The two owner titles are added here and cannot be redefined.
 * @param {{ permissions: string[], titles: TitleSpec[] }} spec
 * @returns {Catalog}
 */
export function defineTitles({ permissions, titles }) {
  if (!Array.isArray(permissions) || !Array.isArray(titles)) throw new TypeError("permissions and titles must be arrays");
  const all = [...new Set([...permissions, MANAGE_MEMBERS])];
  for (const p of all) if (typeof p !== "string" || !ID.test(p)) throw new TypeError(`permission ids are snake_case, got ${p}`);
  const known = new Set(all);
  /** @type {Map<string, Title>} */
  const map = new Map([
    [PRIMARY_OWNER, { id: PRIMARY_OWNER, label: "Primary Owner", layer: 0, permissions: all, expires: false }],
    [OWNER, { id: OWNER, label: "Owner", layer: 1, permissions: all, expires: false }],
  ]);
  for (const t of titles) {
    if (typeof t?.id !== "string" || !ID.test(t.id)) throw new TypeError(`title ids are snake_case, got ${t?.id}`);
    if (map.has(t.id)) throw new TypeError(`title ${t.id} is defined twice or is reserved`);
    if (t.layer !== 2 && t.layer !== 3) throw new TypeError(`title ${t.id}: an app's own titles sit on layer 2 or 3, got ${t.layer}`);
    if (typeof t.label !== "string" || !t.label.trim()) throw new TypeError(`title ${t.id} needs a label`);
    if (typeof t.expires !== "boolean") throw new TypeError(`title ${t.id}: say whether it expires`);
    if (!Array.isArray(t.permissions)) throw new TypeError(`title ${t.id}: permissions must be an array`);
    for (const p of t.permissions) if (!known.has(p)) throw new TypeError(`title ${t.id} names unknown permission ${p}`);
    map.set(t.id, { id: t.id, label: t.label, layer: t.layer, permissions: [...new Set(t.permissions)], expires: t.expires });
  }
  return { permissions: all, titles: map };
}

/** @param {string} date */
function dayStart(date) {
  if (typeof date !== "string" || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new TypeError(`not a YYYY-MM-DD date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

/** Whether a row's end date has passed at `nowMs`. A null end date never passes. @param {MemberRow} row @param {number} nowMs */
export function isExpired(row, nowMs) {
  return row.end_date !== null && nowMs >= dayStart(row.end_date) + DAY_MS;
}

/** Whether the lead's "still on your team?" review is open for this row. @param {MemberRow} row @param {number} nowMs */
export function reviewOpen(row, nowMs) {
  return row.status === "active" && row.end_date !== null && !isExpired(row, nowMs) && nowMs >= dayStart(row.end_date) - REVIEW_DAYS * DAY_MS;
}

/**
 * Who is asking. The Primary Owner comes from deployment configuration and has no row; anyone else needs an
 * active, unexpired row with a title the app defines. Read the row on every request, uncached, so a removal
 * or an expiry takes effect on the next click. Returns null for a person with no access.
 * @param {string} email the verified Access email
 * @param {MemberRow | null | undefined} row this email's row, if any
 * @param {{ catalog: Catalog, primaryOwnerEmail: string, nowMs: number }} context
 * @returns {Actor | null}
 */
export function resolveActor(email, row, { catalog, primaryOwnerEmail, nowMs }) {
  const who = normalizeEmail(email);
  if (!primaryOwnerEmail) throw new TypeError("PRIMARY_OWNER_EMAIL is not set");
  if (who === normalizeEmail(primaryOwnerEmail)) return actorFor(who, catalog.titles.get(PRIMARY_OWNER));
  if (!row || normalizeEmail(row.email) !== who || row.status !== "active" || isExpired(row, nowMs)) return null;
  const title = catalog.titles.get(row.title);
  if (!title || title.layer === 0) return null;
  return actorFor(who, title);
}

/** @param {string} email @param {Title | undefined} title @returns {Actor} */
function actorFor(email, title) {
  if (!title) throw new TypeError("unknown title");
  return { email, title: title.id, layer: title.layer, permissions: new Set(title.permissions) };
}

/** Whether the actor holds a permission. The only question a handler asks. @param {Actor | null} actor @param {string} permission */
export function can(actor, permission) {
  return !!actor && actor.permissions.has(permission);
}

/**
 * The end date a title gets by default: the first of the app's term end dates after today. Titles that do
 * not expire get null. Refuses when the Owner has not entered a future term end yet, so no row is written
 * with an invented date.
 * @param {Title} title
 * @param {string[]} termEnds the app's semester or term end dates, entered once a year by an Owner
 * @param {number} nowMs
 * @param {string | null} [after] renew: the row's current end date, so the next term is the one after it
 */
export function defaultEndDate(title, termEnds, nowMs, after = null) {
  if (!title.expires) return null;
  const floor = Math.max(nowMs, after ? dayStart(after) + DAY_MS : nowMs);
  const next = [...termEnds].map((d) => [d, dayStart(d)]).filter(([, t]) => t + DAY_MS > floor).sort((a, b) => a[1] - b[1])[0];
  if (!next) throw new RangeError("no term end date after today: an Owner enters this year's dates first");
  return next[0];
}

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
export function checkChange(actor, change, { catalog, primaryOwnerEmail, termEnds, nowMs }) {
  if (!actor) return refuse("not signed in as a member");
  if (!can(actor, MANAGE_MEMBERS)) return refuse("you do not hold manage_members");
  const primary = normalizeEmail(primaryOwnerEmail);

  const email = change.kind === "add" ? change.email : change.target?.email;
  if (typeof email !== "string") return refuse(change.kind === "add" ? "an email is required" : "the person's row is required");
  const who = normalizeEmail(email);
  if (who === primary) return refuse("the Primary Owner is set in deployment configuration, not here");

  if (change.kind !== "add") {
    const current = catalog.titles.get(/** @type {MemberRow} */ (change.target).title);
    if (!current) return refuse(`unknown current title ${change.target?.title}`);
    if (current.layer <= actor.layer) return refuse("you manage only people below your own layer");
  }

  if (change.kind === "add" || change.kind === "change_title") {
    const title = catalog.titles.get(/** @type {string} */ (change.title));
    if (!title || title.layer === 0) return refuse(`unknown title ${change.title}`);
    if (title.layer <= actor.layer) return refuse("you can give only titles below your own layer");
    const wider = title.permissions.filter((p) => !actor.permissions.has(p));
    if (wider.length) return refuse(`you cannot grant what you do not hold: ${wider.join(", ")}`);
    if (change.kind === "change_title") {
      if (title.id === change.target?.title) return refuse("that is already their title");
      if (typeof change.reason !== "string" || !change.reason.trim() || /[\r\n]/.test(change.reason)) return refuse("a one-line reason is required");
    }
    if (change.kind === "add") {
      const limit = defaultEndDate(title, termEnds, nowMs);
      if (limit === null) {
        if (change.end_date != null) return refuse(`${title.label} does not expire`);
      } else {
        if (typeof change.end_date !== "string") return refuse("an end date is required");
        const end = dayStart(change.end_date);
        if (end > dayStart(limit)) return refuse(`the end date can be shortened, not lengthened past ${limit}`);
        if (end + DAY_MS <= nowMs) return refuse("the end date has already passed");
      }
    }
  }

  if (change.kind === "renew") {
    const title = /** @type {Title} */ (catalog.titles.get(/** @type {MemberRow} */ (change.target).title));
    if (!title.expires) return refuse(`${title.label} does not expire`);
    if (change.target?.status === "removed") return refuse("a removed person is added again, not renewed");
  }
  if (change.kind === "remove" && change.target?.status === "removed") return refuse("already removed");
  return { ok: true };
}

/** @param {string} reason @returns {Verdict} */
function refuse(reason) {
  return { ok: false, reason };
}

/**
 * The `member_audit` row for a change, written in the same batch as the member row. `cloudflare` starts
 * "pending" and the sync's answer updates it, so a failed sync shows and is retried, never ignored.
 * @param {{ actor: Actor, action: "add" | "change_title" | "renew" | "remove" | "expire", email: string, before: MemberRow | null, after: MemberRow | null, reason?: string, nowMs: number }} entry
 */
export function auditRow({ actor, action, email, before, after, reason, nowMs }) {
  return {
    at: new Date(nowMs).toISOString(),
    actor: actor.email,
    actor_title: actor.title,
    action,
    member_email: normalizeEmail(email),
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    reason: reason ?? null,
    cloudflare: "pending",
  };
}

/**
 * The emails that belong on the app's Access allow list: every active, unexpired row. The Primary Owner is
 * not on it; admin surfaces list Dustin's emails directly in their own policies.
 * @param {MemberRow[]} rows
 * @param {number} nowMs
 */
export function allowList(rows, nowMs) {
  return [...new Set(rows.filter((r) => r.status === "active" && !isExpired(r, nowMs)).map((r) => normalizeEmail(r.email)))].sort();
}
