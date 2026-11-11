#!/usr/bin/env node
/**
 * Refreshes the package's copy of the disposable-email blocklist from its source, so no domain is typed from memory:
 *
 *   node update-disposable.mjs
 *
 * It reads disposable_email_blocklist.conf from https://github.com/disposable-email-domains/disposable-email-domains
 * (CC0 1.0, the list PyPI and many sign-up forms use: one lowercase domain a line, reviewed by pull request) and writes
 * disposable-domains.mjs beside this file with the source and the date it was read. Exits non-zero when the file
 * cannot be read or looks wrong (fewer than 1,000 domains, or a line that is not a domain), so a failed refresh never
 * leaves a half-written list. `./sign-in` refuses a new account at any of these domains (isDisposableEmail).
 *
 * NETWORK_EXTRA adds the throwaway domains a site blocked before the shared list and the source lacks. Each needs a
 * reason; send it upstream as well, and drop it here once the source carries it.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const REPO = "https://github.com/disposable-email-domains/disposable-email-domains";
/** Throwaway domains Foxhound blocked before the shared list (app/lib/auth/disposable-emails.ts) that the source lacks. */
const NETWORK_EXTRA = ["burnermail.io", "tempmail.com"];

const res = await fetch(SOURCE, { headers: { "user-agent": "site-runtime disposable update" } });
if (!res.ok) throw new Error(`${SOURCE} answered ${res.status}`);
const upstream = (await res.text())
  .split("\n")
  .map((line) => line.trim().toLowerCase())
  .filter((line) => line && !line.startsWith("#"));
const domains = [...new Set([...upstream, ...NETWORK_EXTRA])].sort();
const bad = domains.find(
  (d) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d),
);
if (bad) throw new Error(`not a domain: ${JSON.stringify(bad)}`);
if (domains.length < 1000) throw new Error(`only ${domains.length} domains: refusing to write`);

const read = new Date().toISOString().slice(0, 10);
await writeFile(
  join(import.meta.dirname, "disposable-domains.mjs"),
  `// Written by update-disposable.mjs on ${read} from ${REPO} (CC0 1.0), plus its NETWORK_EXTRA. Never edited by hand: run the script.
// ${domains.length} domains.
export const DISPOSABLE_DOMAINS = new Set(${JSON.stringify(domains)});
`,
);
console.log(`disposable-domains.mjs: ${domains.length} domains, read ${read}`);
