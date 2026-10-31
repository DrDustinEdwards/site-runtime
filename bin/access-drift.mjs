#!/usr/bin/env node
// site-runtime-access-drift: the access drift check (I2), run on a schedule in a site's CI. It reads a Cloudflare
// Access application's policies through the Cloudflare API and compares the addresses they let in with the site's own
// admin list, so a person removed from one and not the other is found.
//
//   CLOUDFLARE_API_TOKEN=... ADMIN_EMAILS=a@example.com,b@example.com \
//     site-runtime-access-drift --account <account id> --app "<application name>" [--admins-file admins.txt]
//
// The token needs Access: Apps and Policies Read (and Zero Trust Read when a policy uses an email list); it is sent to
// api.cloudflare.com only and never printed. The admin list is ADMIN_EMAILS, or --admins-file (one address per line or
// comma-separated, `#` comments). Each difference is a GitHub annotation; exit 0 when they match, 1 on drift, 2 when
// the check cannot run.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { accessAllowed, accessDrift, parseAdminList } from "../access-drift.mjs";

const usage =
  'usage: CLOUDFLARE_API_TOKEN=... [ADMIN_EMAILS=...] site-runtime-access-drift --account <id> --app "<name>" [--admins-file <path>]';
/** @param {string} message */
const fail = (message) => {
  console.error(`site-runtime-access-drift: ${message}\n${usage}`);
  process.exit(2);
};

let values;
try {
  ({ values } = parseArgs({ options: { account: { type: "string" }, app: { type: "string" }, "admins-file": { type: "string" } } }));
} catch (error) {
  fail(/** @type {Error} */ (error).message);
}
const accountId = values?.account ?? process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !values?.app) fail("--account and --app are required");
if (!token) fail("CLOUDFLARE_API_TOKEN is not set");
let adminText = process.env.ADMIN_EMAILS ?? "";
if (values?.["admins-file"]) {
  try {
    adminText = readFileSync(values["admins-file"], "utf8");
  } catch (error) {
    fail(`cannot read ${values["admins-file"]}: ${/** @type {Error} */ (error).message}`);
  }
}
const admins = parseAdminList(adminText);
if (admins.length === 0) fail("the admin list is empty: set ADMIN_EMAILS or pass --admins-file");

let drift;
try {
  drift = accessDrift(await accessAllowed({ accountId: String(accountId), appName: String(values?.app), token: String(token) }), admins);
} catch (error) {
  fail(/** @type {Error} */ (error).message);
}
const { onlyInAccess, onlyInApp, open } = /** @type {import("../access-drift.mjs").Drift} */ (drift);
for (const email of onlyInAccess) console.log(`::error title=I2 access drift::${email} is let in by Access but is not an admin in the app`);
for (const email of onlyInApp) console.log(`::error title=I2 access drift::${email} is an admin in the app but Access does not let them in`);
for (const rule of open) console.log(`::error title=I2 access drift::${rule} lets in people the app's list cannot name`);
const count = onlyInAccess.length + onlyInApp.length + open.length;
console.log(`site-runtime-access-drift: "${values?.app}": ${admins.length} admins in the app; ${count ? `${count} differences` : "Access matches"}.`);
process.exit(count ? 1 : 0);
