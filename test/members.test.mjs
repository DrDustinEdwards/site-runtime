import assert from "node:assert/strict";
import { test } from "node:test";
import { allowList, auditRow, can, checkChange, defaultEndDate, defineTitles, isExpired, resolveActor, reviewOpen } from "../members/index.mjs";

// A team's bundles, as an app would pass them.
const catalog = defineTitles({
  permissions: ["read", "comment", "submit", "read_all", "edit_settings", "draft"],
  titles: [
    { id: "team_lead", label: "Team lead", layer: 2, expires: true, permissions: ["read", "comment", "submit", "read_all", "edit_settings", "draft", "manage_members"] },
    { id: "contributor", label: "Contributor", layer: 3, expires: true, permissions: ["read", "comment", "submit"] },
    { id: "reviewer", label: "Reviewer", layer: 3, expires: true, permissions: ["read", "edit_settings"] },
  ],
});
const PRIMARY = "Alex@Example.org";
const NOW = Date.parse("2026-10-10T12:00:00Z");
const termEnds = ["2026-12-18", "2027-05-14", "2026-05-15"];
const ctx = { catalog, primaryOwnerEmail: PRIMARY, termEnds, nowMs: NOW };
const row = (email, title, extra = {}) => ({ email, title, end_date: title === "owner" ? null : "2026-12-18", status: "active", ...extra });

const primary = resolveActor("alex@example.org", null, ctx);
const owner = resolveActor("sam@example.org", row("sam@example.org", "owner"), ctx);
const manager = resolveActor("jordan@example.org", row("jordan@example.org", "team_lead"), ctx);
const worker = resolveActor("w@example.org", row("w@example.org", "contributor"), ctx);

test("the Primary Owner comes from configuration, with no row, and holds every permission", () => {
  assert.equal(primary?.layer, 0);
  assert.deepEqual([...primary.permissions].sort(), [...catalog.permissions].sort());
  assert.equal(resolveActor("alex@example.org", row("alex@example.org", "contributor"), ctx)?.layer, 0, "a row cannot lower the Primary Owner");
});

test("a removed, expired, mismatched or unknown-title row grants nothing", () => {
  assert.equal(resolveActor("w@example.org", row("w@example.org", "contributor", { status: "removed" }), ctx), null);
  assert.equal(resolveActor("w@example.org", row("w@example.org", "contributor", { end_date: "2026-10-09" }), ctx), null);
  assert.equal(resolveActor("w@example.org", row("other@example.org", "contributor"), ctx), null);
  assert.equal(resolveActor("w@example.org", row("w@example.org", "primary_owner"), ctx), null, "a row cannot claim layer 0");
  assert.equal(resolveActor("w@example.org", null, ctx), null);
});

test("handlers check permissions, never titles", () => {
  assert.equal(can(worker, "submit"), true);
  assert.equal(can(worker, "read_all"), false);
  assert.equal(can(worker, "manage_members"), false);
  assert.equal(can(manager, "manage_members"), true);
  assert.equal(can(null, "read"), false);
});

test("plant: a lead granting their own layer is refused", () => {
  const v = checkChange(manager, { kind: "add", email: "new@example.org", title: "team_lead", end_date: "2026-12-18" }, ctx);
  assert.equal(v.ok, false);
  assert.match(v.reason, /below your own layer/);
  assert.equal(checkChange(manager, { kind: "remove", target: row("jordan2@example.org", "team_lead") }, ctx).ok, false, "nor removing a peer");
  assert.equal(checkChange(manager, { kind: "add", email: "new@example.org", title: "contributor", end_date: "2026-12-18" }, ctx).ok, true);
});

test("plant: a bundle wider than the granter's is refused", () => {
  const narrowCtx = { ...ctx, catalog: defineTitles({
    permissions: ["read", "edit_settings"],
    titles: [
      { id: "team_lead", label: "Team lead", layer: 2, expires: true, permissions: ["read", "manage_members"] },
      { id: "reviewer", label: "Reviewer", layer: 3, expires: true, permissions: ["read", "edit_settings"] },
    ],
  }) };
  const narrow = resolveActor("x@example.org", row("x@example.org", "team_lead"), narrowCtx);
  const v = checkChange(narrow, { kind: "add", email: "s@example.org", title: "reviewer", end_date: "2026-12-18" }, narrowCtx);
  assert.equal(v.ok, false);
  assert.match(v.reason, /do not hold: edit_settings/);
});

test("plant: an Owner cannot remove or demote the Primary Owner, or manage another Owner", () => {
  const target = row("alex@example.org", "owner");
  assert.equal(checkChange(owner, { kind: "remove", target }, ctx).ok, false);
  assert.equal(checkChange(owner, { kind: "change_title", target, title: "contributor", reason: "demote" }, ctx).ok, false);
  assert.equal(checkChange(owner, { kind: "add", email: "o2@example.org", title: "owner", end_date: null }, ctx).ok, false);
  const stray = row("ALEX@example.org", "contributor");
  assert.match(checkChange(owner, { kind: "remove", target: stray }, ctx).reason, /deployment configuration/, "a stray row under his email is still him");
  assert.equal(checkChange(owner, { kind: "change_title", target: stray, title: "reviewer", reason: "demote" }, ctx).ok, false);
  assert.equal(checkChange(owner, { kind: "add", email: "alex@example.org", title: "contributor", end_date: "2026-12-18" }, ctx).ok, false);
  assert.equal(checkChange(primary, { kind: "remove", target: row("sam@example.org", "owner") }, ctx).ok, true, "the Primary Owner can remove an Owner");
  assert.equal(checkChange(owner, { kind: "remove", target: row("jordan@example.org", "team_lead") }, ctx).ok, true);
});

test("nobody manages themselves, and a worker manages nobody", () => {
  assert.match(checkChange(owner, { kind: "remove", target: row("sam@example.org", "owner") }, ctx).reason, /own layer/);
  assert.match(checkChange(worker, { kind: "remove", target: row("w2@example.org", "contributor") }, ctx).reason, /manage_members/);
  assert.equal(checkChange(null, { kind: "remove", target: row("w2@example.org", "contributor") }, ctx).ok, false);
});

test("a title change needs a one-line reason", () => {
  const target = row("w@example.org", "contributor");
  assert.equal(checkChange(manager, { kind: "change_title", target, title: "reviewer", reason: "" }, ctx).ok, false);
  assert.equal(checkChange(manager, { kind: "change_title", target, title: "reviewer", reason: "two\nlines" }, ctx).ok, false);
  assert.equal(checkChange(manager, { kind: "change_title", target, title: "reviewer", reason: "leads the newsletter now" }, ctx).ok, true);
});

test("end dates: the next term end, shortened only, never invented", () => {
  const worker_ = catalog.titles.get("contributor");
  assert.equal(defaultEndDate(worker_, termEnds, NOW), "2026-12-18");
  assert.equal(defaultEndDate(worker_, termEnds, NOW, "2026-12-18"), "2027-05-14", "renew moves to the following term");
  assert.equal(defaultEndDate(catalog.titles.get("owner"), termEnds, NOW), null);
  assert.throws(() => defaultEndDate(worker_, ["2026-05-15"], NOW), /enters this year's dates/);
  const add = (end_date) => checkChange(manager, { kind: "add", email: "n@example.org", title: "contributor", end_date }, ctx);
  assert.equal(add("2026-11-30").ok, true);
  assert.equal(add("2027-05-14").ok, false, "past the default");
  assert.equal(add("2026-10-01").ok, false, "already passed");
  assert.equal(add(null).ok, false);
});

test("expiry runs through the end date, and the review opens three weeks before", () => {
  const r = row("w@example.org", "contributor");
  assert.equal(isExpired(r, Date.parse("2026-12-18T23:59:59Z")), false);
  assert.equal(isExpired(r, Date.parse("2026-12-19T00:00:00Z")), true);
  assert.equal(reviewOpen(r, Date.parse("2026-11-26T23:59:59Z")), false);
  assert.equal(reviewOpen(r, Date.parse("2026-11-27T00:00:00Z")), true);
  assert.equal(isExpired(row("o@example.org", "owner"), Date.parse("2099-01-01T00:00:00Z")), false);
});

test("the allow list is every active, unexpired row with a known title, and the audit row starts pending", () => {
  const rows = [row("B@example.org", "contributor"), row("a@example.org", "contributor", { status: "removed" }), row("c@example.org", "contributor", { end_date: "2026-01-01" }), row("d@example.org", "no_such_title")];
  assert.deepEqual(allowList(rows, NOW, catalog), ["b@example.org"]);
  const audit = auditRow({ actor: manager, action: "remove", email: "W@example.org", before: rows[0], after: null, nowMs: NOW });
  assert.equal(audit.cloudflare, "pending");
  assert.equal(audit.member_email, "w@example.org");
  assert.equal(audit.actor, "jordan@example.org");
});

test("defineTitles refuses reserved, misplaced and unknown-permission titles", () => {
  const t = (title) => () => defineTitles({ permissions: ["read"], titles: [title] });
  assert.throws(t({ id: "owner", label: "Owner", layer: 2, expires: false, permissions: [] }), /reserved/);
  assert.throws(t({ id: "boss", label: "Boss", layer: 1, expires: false, permissions: [] }), /layer 2 or 3/);
  assert.throws(t({ id: "boss", label: "Boss", layer: 2, expires: true, permissions: ["write"] }), /unknown permission/);
});
