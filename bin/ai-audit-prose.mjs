/** Any origin: public AI-written text (W1, W3) and the models in use against Anthropic's deprecations (C8). */

import {
  DEPRECATIONS_URL,
  MODEL_IDS,
  deprecationProblems,
  parseDeprecations,
} from "../anthropic.mjs";
import { checkProse } from "../prose.mjs";
import { TIMEOUT_MS } from "./ai-audit-wire.mjs";

/** @import { Ctx } from "./ai-audit-wire.mjs" */

/**
 * `html` without its script, style, noscript, template and svg elements, each replaced by a space: an element with no
 * closing tag is left as it is. One search per element name finds its next closing tag, so a run of unclosed openers is
 * read once, not rescanned from each.
 * @param {string} html
 */
function dropBlocks(html) {
  const open = /<(script|style|noscript|template|svg)\b/gi;
  /** @type {Map<string, number>} */
  const closeAt = new Map();
  let out = "";
  let at = 0;
  let m;
  while ((m = open.exec(html))) {
    const name = (m[1] ?? "").toLowerCase();
    let close = closeAt.get(name);
    if (close === -1) continue;
    if (close === undefined || close < m.index) {
      const re = new RegExp(`</${name}>`, "gi");
      re.lastIndex = m.index;
      close = re.exec(html)?.index ?? -1;
      closeAt.set(name, close);
      if (close === -1) continue;
    }
    out += `${html.slice(at, m.index)} `;
    at = close + name.length + 3;
    open.lastIndex = at;
  }
  return out + html.slice(at);
}

/** A page's readable text: no script, style or markup, block ends as line breaks, the common entities decoded. */
function textOf(/** @type {string} */ html) {
  return dropBlocks(html)
    .replace(
      /<\/?(?:p|div|li|h[1-6]|br|section|article|blockquote|tr|td|th|dd|dt)\b[^<>]*>/gi,
      "\n",
    )
    .replace(/<[^<>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;/g, "’")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** W1 and W3: each page's text through checkProse, as the model that wrote it. */
export async function auditProse(
  /** @type {Ctx} */ { get, report },
  /** @type {string} */ origin,
  /** @type {string[]} */ paths,
  /** @type {string | undefined} */ proseModel,
) {
  const model = proseModel ?? "claude";
  for (const path of paths) {
    const page = await get(origin + path, { headers: { accept: "text/html" } });
    if (!page.res) {
      report("error", "W1", page.url, page.why);
      continue;
    }
    if (!page.res.ok) {
      report("error", "W1", page.url, `answered ${page.res.status}`);
      await page.res.body?.cancel().catch(() => {});
      continue;
    }
    for (const issue of checkProse(textOf(await page.res.text()), { model, dashes: "allow" })) {
      if (issue.severity !== "high") continue;
      const leftover = ["leftover", "placeholder", "markup"].includes(issue.check);
      report(
        leftover ? "error" : "warning",
        leftover ? "W3" : "W1",
        page.url,
        `${issue.message}`.slice(0, 200),
      );
    }
  }
}

/** C8: MODEL_IDS against Anthropic's deprecations page. */
export async function auditModels(/** @type {Ctx} */ { report }) {
  /** @type {string} */
  let page = "";
  try {
    const res = await fetch(DEPRECATIONS_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "site-runtime-ai-audit" },
    });
    page = res.ok ? await res.text() : "";
  } catch {}
  const table = parseDeprecations(page);
  if (Object.keys(table).length === 0)
    return report(
      "unmeasured",
      "C8",
      DEPRECATIONS_URL,
      "could not read the model table, so the models were not checked today",
    );
  for (const problem of deprecationProblems(Object.values(MODEL_IDS), table))
    report("error", "C8", DEPRECATIONS_URL, problem);
}
