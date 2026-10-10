import assert from "node:assert/strict";
import { test } from "node:test";
import { allowList, auditRow, can, checkChange, defaultEndDate, defineTitles, isExpired, resolveActor, reviewOpen } from "../members/index.mjs";

// The lab's bundles from the design, as an app would pass them.
const catalog = defineTitles({
  permissions: ["read", "use_lot", "record_run", "read_all_runs", "edit_inventory", "draft_procedure"],
  titles: [
    { id: "lab_manager", label: "Lab manager", layer: 2, expires: true, permissions: ["read", "use_lot", "record_run", "read_all_runs", "edit_inventory", "draft_procedure", "manage_members"] },
    { id: "lab_worker", label: "Lab worker", layer: 3, expires: true, permissions: ["read", "use_lot", "record_run"] },
    { id: "safety_officer", label: "Safety officer", layer: 3, expires: true, permissions: ["read", "edit_inventory"] },
  ],
});
const PRIMARY = "Dustin@Example.org";
const NOW = Date.parse("2026-10-10T12:00:00Z");
const termEnds = ["2026-12-18", "2027-05-14", "2026-05-15"];
const ctx = { catalog, primaryOwnerEmail: PRIMARY, termEnds, nowMs: NOW };
const row = (email, title, extra = {}) => ({ email, title, end_date: title === "owner" ? null : "2026-12-18", status: "active", ...extra });

const primary = resolveActor("dustin@example.org", null, ctx);
const owner = resolveActor("wife@example.org", row("wife@example.org", "owner"), ctx);
const manager = resolveActor("lm@example.org", row("lm@example.org", "lab_manager"), ctx);
const worker = resolveActor("w@example.org", row("w@example.org", "lab_worker"), ctx);

test("the Primary Owner comes from configuration, with no row, and holds every permission", () => {
  assert.equal(primary?.layer, 0);
  assert.deepEqual([...primary.permissions].sort(), [...catalog.permissions].sort());
  assert.equal(resolveActor("dustin@example.org", row("dustin@example.org", "lab_worker"), ctx)?.layer, 0, "a row cannot lower the Primary Owner");
});

test("a removed, expired, mismatched or unknown-title row grants nothing", () => {
  assert.equal(resolveActor("w@example.org", row("w@example.org", "lab_worker", { status: "removed" }), ctx), null);
  assert.equal(resolveActor("w@example.org", row("w@example.org", "lab_worker", { end_date: "2026-10-09" }), ctx), null);
  assert.equal(resolveActor("w@example.org", row("other@example.org", "lab_worker"), ctx), null);
  assert.equal(resolveActor("w@example.org", row("w@example.org", "primary_owner"), ctx), null, "a row cannot claim layer 0");
  assert.equal(resolveActor("w@example.org", null, ctx), null);
});

test("handlers check permissions, never titles", () => {
  assert.equal(can(worker, "record_run"), true);
  assert.equal(can(worker, "read_all_runs"), false);
  assert.equal(can(worker, "manage_members"), false);
  assert.equal(can(manager, "manage_members"), true);
  assert.equal(can(null, "read"), false);
});

test("plant: a lead granting their own layer is refused", () => {
  const v = checkChange(manager, { kind: "add", email: "new@example.org", title: "lab_manager", end_date: "2026-12-18" }, ctx);
  assert.equal(v.ok, false);
  assert.match(v.reason, /below your own layer/);
  assert.equal(checkChange(manager, { kind: "remove", target: row("lm2@example.org", "lab_manager") }, ctx).ok, false, "nor removing a peer");
  assert.equal(checkChange(manager, { kind: "add", email: "new@example.org", title: "lab_worker", end_date: "2026-12-18" }, ctx).ok, true);
});

test("plant: a bundle wider than the granter's is refused", () => {
  const narrowCtx = { ...ctx, catalog: defineTitles({
    permissions: ["read", "edit_inventory"],
    titles: [
      { id: "lab_manager", label: "Lab manager", layer: 2, expires: true, permissions: ["read", "manage_members"] },
      { id: "safety_officer", label: "Safety officer", layer: 3, expires: true, permissions: ["read", "edit_inventory"] },
    ],
  }) };
  const narrow = resolveActor("x@example.org", row("x@example.org", "lab_manager"), narrowCtx);
  const v = checkChange(narrow, { kind: "add", email: "s@example.org", title: "safety_officer", end_date: "2026-12-18" }, narrowCtx);
  assert.equal(v.ok, false);
  assert.match(v.reason, /do not hold: edit_inventory/);
});

test("plant: an Owner cannot remove or demote the Primary Owner, or manage another Owner", () => {
  const target = row("dustin@example.org", "owner");
  assert.equal(checkChange(owner, { kind: "remove", target }, ctx).ok, false);
  assert.equal(checkChange(owner, { kind: "change_title", target, title: "lab_worker", reason: "demote" }, ctx).ok, false);
  assert.equal(checkChange(owner, { kind: "add", email: "o2@example.org", title: "owner", end_date: null }, ctx).ok, false);
  const stray = row("DUSTIN@example.org", "lab_worker");
  assert.match(checkChange(owner, { kind: "remove", target: stray }, ctx).reason, /deployment configuration/, "a stray row under his email is still him");
  assert.equal(checkChange(owner, { kind: "change_title", target: stray, title: "safety_officer", reason: "demote" }, ctx).ok, false);
  assert.equal(checkChange(owner, { kind: "add", email: "dustin@example.org", title: "lab_worker", end_date: "2026-12-18" }, ctx).ok, false);
  assert.equal(checkChange(primary, { kind: "remove", target: row("wife@example.org", "owner") }, ctx).ok, true, "the Primary Owner can remove an Owner");
  assert.equal(checkChange(owner, { kind: "remove", target: row("lm@example.org", "lab_manager") }, ctx).ok, true);
});

test("nobody manages themselves, and a worker manages nobody", () => {
  assert.match(checkChange(owner, { kind: "remove", target: row("wife@example.org", "owner") }, ctx).reason, /own layer/);
  assert.match(checkChange(worker, { kind: "remove", target: row("w2@example.org", "lab_worker") }, ctx).reason, /manage_members/);
  assert.equal(checkChange(null, { kind: "remove", target: row("w2@example.org", "lab_worker") }, ctx).ok, false);
});

test("a title change needs a one-line reason", () => {
  const target = row("w@example.org", "lab_worker");
  assert.equal(checkChange(manager, { kind: "change_title", target, title: "safety_officer", reason: "" }, ctx).ok, false);
  assert.equal(checkChange(manager, { kind: "change_title", target, title: "safety_officer", reason: "two\nlines" }, ctx).ok, false);
  assert.equal(checkChange(manager, { kind: "change_title", target, title: "safety_officer", reason: "runs the stockroom now" }, ctx).ok, true);
});

test("end dates: the next term end, shortened only, never invented", () => {
  const worker_ = catalog.titles.get("lab_worker");
  assert.equal(defaultEndDate(worker_, termEnds, NOW), "2026-12-18");
  assert.equal(defaultEndDate(worker_, termEnds, NOW, "2026-12-18"), "2027-05-14", "renew moves to the following term");
  assert.equal(defaultEndDate(catalog.titles.get("owner"), termEnds, NOW), null);
  assert.throws(() => defaultEndDate(worker_, ["2026-05-15"], NOW), /enters this year's dates/);
  const add = (end_date) => checkChange(manager, { kind: "add", email: "n@example.org", title: "lab_worker", end_date }, ctx);
  assert.equal(add("2026-11-30").ok, true);
  assert.equal(add("2027-05-14").ok, false, "past the default");
  assert.equal(add("2026-10-01").ok, false, "already passed");
  assert.equal(add(null).ok, false);
});

test("expiry runs through the end date, and the review opens three weeks before", () => {
  const r = row("w@example.org", "lab_worker");
  assert.equal(isExpired(r, Date.parse("2026-12-18T23:59:59Z")), false);
  assert.equal(isExpired(r, Date.parse("2026-12-19T00:00:00Z")), true);
  assert.equal(reviewOpen(r, Date.parse("2026-11-26T23:59:59Z")), false);
  assert.equal(reviewOpen(r, Date.parse("2026-11-27T00:00:00Z")), true);
  assert.equal(isExpired(row("o@example.org", "owner"), Date.parse("2099-01-01T00:00:00Z")), false);
});

test("the allow list is every active, unexpired row, and the audit row starts pending", () => {
  const rows = [row("B@example.org", "lab_worker"), row("a@example.org", "lab_worker", { status: "removed" }), row("c@example.org", "lab_worker", { end_date: "2026-01-01" })];
  assert.deepEqual(allowList(rows, NOW), ["b@example.org"]);
  const audit = auditRow({ actor: manager, action: "remove", email: "W@example.org", before: rows[0], after: null, nowMs: NOW });
  assert.equal(audit.cloudflare, "pending");
  assert.equal(audit.member_email, "w@example.org");
  assert.equal(audit.actor, "lm@example.org");
});

test("defineTitles refuses reserved, misplaced and unknown-permission titles", () => {
  const t = (title) => () => defineTitles({ permissions: ["read"], titles: [title] });
  assert.throws(t({ id: "owner", label: "Owner", layer: 2, expires: false, permissions: [] }), /reserved/);
  assert.throws(t({ id: "boss", label: "Boss", layer: 1, expires: false, permissions: [] }), /layer 2 or 3/);
  assert.throws(t({ id: "boss", label: "Boss", layer: 2, expires: true, permissions: ["write"] }), /unknown permission/);
});
