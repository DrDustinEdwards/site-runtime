/**
 * Subresource Integrity for a built site's own scripts: every `<script src>` and `<link rel="modulepreload">` in the
 * HTML a build wrote that names a file of the same build gets that file's sha384 `integrity` (integrityHash, ./csp)
 * and `crossorigin`, which Integrity-Policy needs of every script, a classic one included. Written for Vite builds,
 * which write neither (Capsomer's site, the Capsid Portal); `subresourceIntegrity()` is the plugin, `writeIntegrity`
 * the same pass over any built folder. Build tooling only: a Worker never imports this.
 *
 * A module a script imports with `import()` is fetched by Vite's preload helper with no integrity, which only an
 * import map can give it; those show in the Integrity-Policy reports (./csp-report) before enforcing.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { integrityHash } from "./csp.mjs";

const TAG = /<(script|link)\b[^>]*>/gi;

/**
 * Adds integrity to the tags of every .html file under `dir`. `base` is the path the folder is served at (Vite's
 * `base`, `/portal/`), so `/portal/assets/x.js` is `dir/assets/x.js`. A tag that names another origin, a file
 * outside `dir` or one that does not exist, or already carries integrity, is left as it is.
 * @param {string} dir
 * @param {{ base?: string }} [options]
 * @returns {Promise<number>} how many tags were given integrity
 */
export async function writeIntegrity(dir, { base = "/" } = {}) {
  const root = resolve(dir);
  /** @type {Map<string, string | null>} */
  const hashes = new Map();
  const hashOf = async (/** @type {string} */ file) => {
    if (!hashes.has(file)) {
      let bytes = null;
      try {
        bytes = readFileSync(file);
      } catch {}
      hashes.set(file, bytes ? await integrityHash(bytes) : null);
    }
    return hashes.get(file) ?? null;
  };
  let count = 0;
  for (const page of htmlFiles(root)) {
    const html = readFileSync(page, "utf8");
    const pagePath = `${base.replace(/\/?$/, "/")}${relative(root, page).split(sep).join("/")}`;
    /** @type {string[]} */
    const parts = [];
    let at = 0;
    for (const match of html.matchAll(TAG)) {
      const tag = match[0];
      const isScript = match[1]?.toLowerCase() === "script";
      const url = attribute(tag, isScript ? "src" : "href");
      const eligible = url && !/\sintegrity\s*=/i.test(tag) && (isScript || /^modulepreload$/i.test(attribute(tag, "rel") ?? ""));
      const file = eligible ? localFile(url, pagePath, base, root) : null;
      const hash = file ? await hashOf(file) : null;
      if (!hash) continue;
      const cors = /\scrossorigin(\s*=|[\s>/])/i.test(tag) ? "" : ' crossorigin="anonymous"';
      parts.push(html.slice(at, match.index), tag.replace(/\s*\/?>$/, (end) => ` integrity="${hash}"${cors}${end.trim() === "/>" ? " />" : ">"}`));
      at = (match.index ?? 0) + tag.length;
      count += 1;
    }
    if (at > 0) writeFileSync(page, parts.join("") + html.slice(at));
  }
  return count;
}

/**
 * The Vite plugin: writeIntegrity over the output folder once the build is written, with Vite's `base`.
 * @returns {{ name: string, apply: "build", enforce: "post", configResolved(config: { base: string }): void, writeBundle(options: { dir?: string }): Promise<void> }}
 */
export function subresourceIntegrity() {
  let base = "/";
  return {
    name: "site-runtime-sri",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      base = config.base;
    },
    async writeBundle(options) {
      if (options.dir) await writeIntegrity(options.dir, { base });
    },
  };
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** @param {string} url @param {string} pagePath @param {string} base @param {string} root */
function localFile(url, pagePath, base, root) {
  const resolved = new URL(url, `https://site.invalid${pagePath}`);
  if (resolved.origin !== "https://site.invalid") return null;
  const prefix = base.replace(/\/?$/, "/");
  if (!resolved.pathname.startsWith(prefix)) return null;
  const file = resolve(root, decodeURIComponent(resolved.pathname.slice(prefix.length)));
  return file.startsWith(root + sep) ? file : null;
}

/** @param {string} dir @returns {string[]} */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

