// The check behind site-runtime-session-check (bin/session-check.mjs): every server-side Better Auth session read goes
// through `sessionLookup` (./sign-in), since a hand-written `auth.api.getSession({ headers, request })` gets a Response
// with no `user` and reads every signed-in person as signed out (Foxing #169, txasm).

import { readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  ".react-router",
  ".wrangler",
  "coverage",
]);
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;
const CALL = /\bapi\s*\.\s*getSession\s*\(\s*/g;

/**
 * The source with its comments blanked to spaces, so line numbers hold. A `//` inside a string is left alone only
 * when it follows a `:` (a URL), which is all a session read sits next to.
 * @param {string} source
 */
function withoutComments(source) {
  const blank = (/** @type {string} */ text) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before) => before + blank(match.slice(before.length)));
}

/**
 * The lines of `source` with an `api.getSession(` call that does not go through `sessionLookup(`.
 * @param {string} source
 * @returns {number[]}
 */
export function directSessionReads(source) {
  const code = withoutComments(source);
  const lines = [];
  for (const match of code.matchAll(CALL)) {
    const after = match.index + match[0].length;
    if (/^sessionLookup\s*\(/.test(code.slice(after))) continue;
    lines.push(code.slice(0, match.index).split("\n").length);
  }
  return lines;
}

/**
 * The source files under `dir`, leaving out node_modules, build output and test files.
 * @param {string} dir
 * @returns {string[]}
 */
export function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return SOURCE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}
