#!/usr/bin/env node
// site-runtime-sign-in: the sign-in and access check, run against a live site every day (devkit live/areas.json, area 3).
// From outside, with no account and no mail sent, it checks the sign-in page (A2, B5, D10), Better Auth's passkey
// relying party (A1), sign-out (D4), origin check (D8) and the link's confirm page (B7), its cookies (D1), the admin
// pages (G1, D10) and the MCP servers' sign-in metadata (H1, H2, H4). Each part runs only when the site has it.
//
//   site-runtime-sign-in --origin https://example.com [--from https://example.workers.dev]
//
// --from fetches from another host (a site not yet on its domain); the passkey's rpId is still held to --origin. Each
// finding is a GitHub annotation, `::error title=<item>::<url> <detail>`; exit 1 on any error, 2 when the site does not
// answer, so an outage never reads as findings. It prints cookie names, never their values.

import { parseArgs } from "node:util";

import { signInFindings } from "../sign-in-live.mjs";

const usage = "usage: site-runtime-sign-in --origin https://example.com [--from https://preview.example]";
let values;
try {
  ({ values } = parseArgs({ options: { origin: { type: "string" }, from: { type: "string" } } }));
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(2);
}
if (!values.origin) {
  console.error(usage);
  process.exit(2);
}

let result;
try {
  result = await signInFindings({ origin: values.origin, from: values.from });
} catch (error) {
  console.error(`site-runtime-sign-in: ${error.message}`);
  process.exit(2);
}
const { findings, found } = result;
for (const finding of findings) console.log(`::${finding.severity} title=${finding.item}::${finding.url} ${finding.detail}`);
const errors = findings.filter((finding) => finding.severity === "error").length;
console.log(`site-runtime-sign-in: ${values.from ?? values.origin}: ${found.length ? found.join(", ") : "no sign-in, admin or MCP"}; ${errors} errors, ${findings.length - errors} warnings.`);
process.exit(errors > 0 ? 1 : 0);
