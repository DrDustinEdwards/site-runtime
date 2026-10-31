#!/usr/bin/env node
// site-runtime-access-drift: the access drift check (I2), run on a schedule in a site's CI (devkit's access-drift.yml).
// It reads a Cloudflare Access application's policies through the Cloudflare API and compares the addresses they let in
// with the site's own admin list, so a person removed from one and not the other is found.
//
//   CLOUDFLARE_API_TOKEN=... ACCESS_CLIENT_ID=... ACCESS_CLIENT_SECRET=... \
//     site-runtime-access-drift --account <account id> --app "<application name>" --admins-url https://example.com/admin/access-drift
//
// The site's list comes from the site itself (--admins-url, its adminListResponse route behind Access, read with an
// Access service token's id and secret): salted hashes, so no copy of the list is kept anywhere else. For a run on your
// own machine, ADMIN_EMAILS or --admins-file (one address per line or comma-separated, `#` comments) stand in for it.
// The token needs Access: Apps and Policies Read (and Zero Trust Read when a policy uses an email list); it and the
// service token's secret are sent only where they belong and never printed. Each difference is a GitHub annotation;
// exit 0 when they match, 1 on drift, 2 when the check cannot run. Addresses print masked (d***@example.com), because a
// public repo's Actions logs are public; --show-addresses prints them whole for a run on your own machine.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { accessAllowed, accessDrift, accessDriftHashed, fetchAdminList, parseAdminList } from "../access-drift.mjs";

const usage =
  'usage: CLOUDFLARE_API_TOKEN=... site-runtime-access-drift --account <id> --app "<name>" (--admins-url <url> with ACCESS_CLIENT_ID and ACCESS_CLIENT_SECRET | ADMIN_EMAILS=... | --admins-file <path>) [--show-addresses]';
/** @param {string} message @returns {never} */
const fail = (message) => {
  console.error(`site-runtime-access-drift: ${message}\n${usage}`);
  process.exit(2);
};

let values;
try {
  ({ values } = parseArgs({
    options: {
      account: { type: "string" },
      app: { type: "string" },
      "admins-url": { type: "string" },
      "admins-file": { type: "string" },
      "show-addresses": { type: "boolean" },
    },
  }));
} catch (error) {
  fail(/** @type {Error} */ (error).message);
}
const accountId = values?.account || process.env.CLOUDFLARE_ACCOUNT_ID;
const appName = values?.app;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !appName) fail("--account and --app are required");
if (!token) fail("CLOUDFLARE_API_TOKEN is not set");

/** @param {string} email */
const shown = (email) => (values?.["show-addresses"] ? email : email.replace(/^(.)[^@]*/, "$1***"));
const say = (/** @type {string} */ text) => console.log(`::error title=I2 access drift::${text}`);

let site;
let admins = 0;
try {
  if (values?.["admins-url"]) {
    const clientId = process.env.ACCESS_CLIENT_ID;
    const clientSecret = process.env.ACCESS_CLIENT_SECRET;
    if (!clientId || !clientSecret) fail("--admins-url needs ACCESS_CLIENT_ID and ACCESS_CLIENT_SECRET (an Access service token)");
    const [found, list] = await Promise.all([
      accessAllowed({ accountId: String(accountId), appName: String(appName), token: String(token) }),
      fetchAdminList(values["admins-url"], { clientId: String(clientId), clientSecret: String(clientSecret) }),
    ]);
    site = await accessDriftHashed(found, list);
    admins = site.admins;
  } else {
    let text = process.env.ADMIN_EMAILS ?? "";
    if (values?.["admins-file"]) text = readFileSync(values["admins-file"], "utf8");
    const list = parseAdminList(text);
    if (list.length === 0) fail("no admin list: pass --admins-url, set ADMIN_EMAILS or pass --admins-file");
    const drift = accessDrift(await accessAllowed({ accountId: String(accountId), appName: String(appName), token: String(token) }), list);
    site = { onlyInAccess: drift.onlyInAccess, onlyInAppCount: drift.onlyInApp.length, onlyInApp: drift.onlyInApp, admins: list.length, open: drift.open };
    admins = list.length;
  }
} catch (error) {
  fail(/** @type {Error} */ (error).message);
}
if (admins === 0) fail("the site's admin list is empty");

const { onlyInAccess, onlyInAppCount, open } = site;
const named = /** @type {{ onlyInApp?: string[] }} */ (site).onlyInApp;
for (const email of onlyInAccess) say(`${shown(email)} is let in by Access but is not an admin in the app`);
if (named) for (const email of named) say(`${shown(email)} is an admin in the app but Access does not let them in`);
else if (onlyInAppCount) say(`${onlyInAppCount} of the app's ${admins} admins ${onlyInAppCount === 1 ? "is" : "are"} not let in by Access`);
for (const rule of open) say(`${rule} lets in people the app's list cannot name`);
const count = onlyInAccess.length + onlyInAppCount + open.length;
console.log(`site-runtime-access-drift: "${appName}": ${admins} admins in the app; ${count ? `${count} differences` : "Access matches"}.`);
process.exit(count ? 1 : 0);
