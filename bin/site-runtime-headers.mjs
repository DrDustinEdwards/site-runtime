#!/usr/bin/env node
/**
 * Writes a site's `_headers` file from its registry entry, the one generator every site's build runs:
 *
 *   site-runtime-headers --site <id> --out public/_headers [--header "tdm-reservation: 1"]...
 *
 * The file is staticHeaders(entry).file (./static-site): the set buildSecurityHeaders({ site }) writes, each `--header`
 * the site adds on top (Prelum's TDMRep header), charset=utf-8 and CORP per static type, a static site's one page
 * policy (`assets.policy`), and the entry's path rules (`assets.paths`). Exit 0 when written, 2 on bad arguments or an
 * unknown id.
 */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { siteEntry } from "../sites.mjs";
import { staticHeaders } from "../static-site.mjs";

try {
  const { values } = parseArgs({ options: { site: { type: "string" }, out: { type: "string" }, header: { type: "string", multiple: true } } });
  if (!values.site || !values.out) throw new Error("--site and --out are required");
  /** @type {Record<string, string>} */
  const headers = {};
  for (const line of values.header ?? []) {
    const at = line.indexOf(":");
    if (at < 1) throw new Error(`--header ${JSON.stringify(line)} is not "Name: value"`);
    headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  writeFileSync(values.out, staticHeaders(siteEntry(values.site), { headers }).file);
} catch (error) {
  console.error(`${error instanceof Error ? error.message : error}\nusage: site-runtime-headers --site <id> --out <file> [--header "Name: value"]...`);
  process.exit(2);
}
