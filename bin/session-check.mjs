#!/usr/bin/env node
// site-runtime-session-check: every server-side Better Auth session read goes through `sessionLookup` (./sign-in).
// Given the request, Better Auth 1.7 answers `auth.api.getSession` with a Response unless the call says
// `asResponse: false`, and a Response has no `user`, so a call written by hand can read every signed-in person as signed
// out (Foxing #169, txasm). `sessionLookup(request)` always says it, and passes the request on a GET for sessionDetails.
//
//   site-runtime-session-check [dir ...]        default: app
//
// Each `api.getSession(` whose argument is not `sessionLookup(...)` is a GitHub annotation,
// `::error file=<path>,line=<n>,title=session-read::...`; exit 1 on any, 0 with none, 2 when a directory is missing.
// Comments are skipped; node_modules, build output and test files are not read.

import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

import { directSessionReads, sourceFiles } from "../session-check.mjs";

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["app"];
const missing = dirs.filter((dir) => !existsSync(dir));
if (missing.length) {
  console.error(`site-runtime-session-check: no such directory: ${missing.join(", ")}`);
  process.exit(2);
}
let found = 0;
let files = 0;
for (const file of dirs.flatMap(sourceFiles)) {
  files += 1;
  for (const line of directSessionReads(readFileSync(file, "utf8"))) {
    found += 1;
    console.log(
      `::error file=${relative(process.cwd(), file)},line=${line},title=session-read::auth.api.getSession needs sessionLookup(request) (site-runtime ./sign-in), which always sets asResponse: false`,
    );
  }
}
console.log(`site-runtime-session-check: ${files} files, ${found} direct getSession calls.`);
process.exit(found > 0 ? 1 : 0);
