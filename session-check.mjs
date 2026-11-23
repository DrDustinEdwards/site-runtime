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
 * The source with its comments blanked to spaces, so line numbers hold. One scan that skips string and template
 * literals, so a `"/*"` or `"/admin/*"` in a string opens no comment.
 * @param {string} source
 */
function withoutComments(source) {
  let out = "";
  for (let i = 0; i < source.length;) {
    const c = source[i];
    const next = source[i + 1];
    let end = i + 1;
    if (c === "/" && next === "/") {
      end = source.indexOf("\n", i);
      if (end < 0) end = source.length;
    } else if (c === "/" && next === "*") {
      end = source.indexOf("*/", i + 2);
      end = end < 0 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      while (end < source.length && source[end] !== c) end += source[end] === "\\" ? 2 : 1;
      end = Math.min(end + 1, source.length);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    const piece = source.slice(i, end);
    out += c === "/" && (next === "/" || next === "*") ? piece.replace(/[^\n]/g, " ") : piece;
    i = end;
  }
  return out;
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
