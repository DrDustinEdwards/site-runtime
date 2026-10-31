/**
 * Subresource Integrity for a built site's own scripts: every `<script src>` and `<link rel="modulepreload">` in the
 * HTML a build wrote that names a file of the same build gets that file's sha384 `integrity` (integrityHash, ./csp)
 * and `crossorigin`, which Integrity-Policy needs of every script, a classic one included. Written for Vite builds,
 * which write neither (Capsomer's site, the Capsid Portal); `subresourceIntegrity()` is the plugin, `writeIntegrity`
 * the same pass over any built folder. Build tooling only: a Worker never imports this.
 *
 * A module script's static imports need integrity too, and a page can give it only by a modulepreload carrying it (an
 * import map is an inline script): so each local module a `<script type="module">` reaches through `import ... from`
 * or `export ... from`, transitively, gets one after the script tag, unless the page preloads it already (Vite does).
 * A module loaded with `import()` gets none, since only an import map could give it one; those show in the
 * Integrity-Policy reports (./csp-report) before enforcing.
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
      const marked = tag.replace(/\s*\/?>$/, (end) => ` integrity="${hash}"${cors}${end.trim() === "/>" ? " />" : ">"}`);
      count += 1;
      if (isScript && /^module$/i.test(attribute(tag, "type") ?? "") && file) {
        const tagEnd = html.indexOf("</script>", (match.index ?? 0) + tag.length);
        if (tagEnd !== -1) {
          const preloaded = preloadsOf(html, pagePath, base, root);
          /** @type {string[]} */
          const links = [];
          for (const dep of moduleImports(file, base, root)) {
            if (preloaded.has(dep)) continue;
            preloaded.add(dep);
            const depHash = await hashOf(dep);
            if (!depHash) continue;
            const href = `${base.replace(/\/?$/, "/")}${relative(root, dep).split(sep).join("/")}`;
            links.push(`<link rel="modulepreload" href="${href}" integrity="${depHash}" crossorigin="anonymous">`);
            count += 1;
          }
          // The preloads go after the script's closing tag.
          parts.push(html.slice(at, match.index), marked, html.slice((match.index ?? 0) + tag.length, tagEnd + 9), links.map((l) => `\n${l}`).join(""));
          at = tagEnd + 9;
          continue;
        }
      }
      parts.push(html.slice(at, match.index), marked);
      at = (match.index ?? 0) + tag.length;
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

/** The local files a page already preloads as modules. @param {string} html @param {string} pagePath @param {string} base @param {string} root */
function preloadsOf(html, pagePath, base, root) {
  /** @type {Set<string>} */
  const files = new Set();
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = attribute(tag, "href");
    const file = href && /^modulepreload$/i.test(attribute(tag, "rel") ?? "") ? localFile(href, pagePath, base, root) : null;
    if (file) files.add(file);
  }
  return files;
}

const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?["']((?:\.{1,2}\/|\/)[^"']+)["']/g;

/**
 * Every local module `entry` reaches through static imports, transitively, in order of discovery, `entry` excluded.
 * @param {string} entry @param {string} base @param {string} root @returns {string[]}
 */
function moduleImports(entry, base, root) {
  /** @type {string[]} */
  const found = [];
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.shift());
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [, specifier] of code.matchAll(STATIC_IMPORT)) {
      const served = `${base.replace(/\/?$/, "/")}${relative(root, file).split(sep).join("/")}`;
      const target = localFile(specifier ?? "", served, base, root);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      found.push(target);
      queue.push(target);
    }
  }
  return found;
}

/** @param {string} dir @returns {string[]} */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

