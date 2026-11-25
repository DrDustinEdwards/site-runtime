/**
 * The model registry and the deprecations check: one table of the models the family calls, with their retirement
 * dates, and what the daily check reads from the deprecations page. ./anthropic re-exports what a caller imports.
 */

/**
 * @typedef {Readonly<{
 * state: "active" | "deprecated" | "retired";
 * deprecated: string | null;
 * retires: string | null;
 * notBefore: string | null;
 * cacheMin: number | null;
 * }>} ModelEntry
 */

const DAY_MS = 86_400_000;

/**
 * The models the family calls, as platform.claude.com/docs/en/about-claude/model-deprecations listed them on
 * 2026-11-13. `retires` is a set retirement date; `notBefore` is the page's "not sooner than" floor for an active model
 * (not a date it stops). `cacheMin` is the minimum cacheable prompt in tokens (build-with-claude/prompt-caching).
 * Refresh from the page; never type a date from memory.
 * @param {string | null} notBefore
 * @param {number | null} cacheMin
 * @returns {ModelEntry}
 */
const active = (notBefore, cacheMin) =>
  Object.freeze({ state: "active", deprecated: null, retires: null, notBefore, cacheMin });

/** @type {Readonly<Record<string, ModelEntry>>} */
export const MODELS = /* @__PURE__ */ Object.freeze({
  "claude-sonnet-5-5": /* @__PURE__ */ active("2027-09-28", 512),
  "claude-sonnet-5": /* @__PURE__ */ active("2027-06-30", 1024),
  "claude-opus-5-5": /* @__PURE__ */ active("2027-09-22", 512),
  "claude-opus-4-8": /* @__PURE__ */ active("2027-05-28", 1024),
  "claude-haiku-5-5": /* @__PURE__ */ active("2027-10-07", 512),
  "claude-haiku-4-5-20251001": /* @__PURE__ */ active("2026-10-15", 4096),
  "claude-sonnet-4-20250514": /* @__PURE__ */ Object.freeze({
    state: "retired",
    deprecated: "2026-04-14",
    retires: "2026-06-15",
    notBefore: null,
    cacheMin: null,
  }),
});
export const MODELS_CHECKED = "2026-11-13";

/** The model each kind of call uses (C8): a site names the role, never an id. `fast` for cheap, frequent calls, `standard` for writing a reader sees, `deep` for long reasoning. */
export const MODEL_IDS = /* @__PURE__ */ Object.freeze({
  fast: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
});

/** The deprecations page as Markdown, which the daily check reads (`parseDeprecations`). */
export const DEPRECATIONS_URL =
  "https://platform.claude.com/docs/en/about-claude/model-deprecations.md";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/** "June 15, 2026" as 2026-06-15, or null. @param {string} text */
function isoDate(text) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && month >= 0
    ? `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`
    : null;
}

/**
 * The model table of the deprecations page (DEPRECATIONS_URL) as entries shaped like MODELS' without `cacheMin`. An
 * empty object when the page holds no such table: "could not check", never "nothing retiring".
 * @param {string} markdown
 * @returns {Record<string, Omit<ModelEntry, "cacheMin">>}
 */
export function parseDeprecations(markdown) {
  /** @type {Record<string, any>} */
  const out = {};
  let inTable = false;
  for (const line of String(markdown).split("\n")) {
    const cells = line.trim().startsWith("|")
      ? line
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim())
      : null;
    if (!cells) inTable = false;
    else if (/^API model name$/i.test(cells[0] ?? "") && /state/i.test(cells[1] ?? ""))
      inTable = true;
    else if (inTable && cells.length >= 4 && /^claude-[a-z0-9.-]+$/.test(cells[0])) {
      const state = cells[1].toLowerCase();
      if (state !== "active" && state !== "deprecated" && state !== "retired") continue;
      const later = /not sooner than/i.test(cells[3]);
      out[cells[0]] = {
        state,
        deprecated: isoDate(cells[2]),
        retires: later ? null : isoDate(cells[3]),
        notBefore: later ? isoDate(cells[3]) : null,
      };
    }
  }
  return out;
}

/**
 * What is wrong with calling `ids` as of `now`, judged by `table` (from `parseDeprecations`): an id the page does not
 * list, one deprecated or retired, one retiring within 60 days, and one MODELS disagrees with. Empty when all is well.
 * @param {readonly string[]} ids
 * @param {Record<string, { state: string; retires: string | null }>} table
 * @param {Date | number} [now]
 * @returns {string[]}
 */
export function deprecationProblems(ids, table, now = Date.now()) {
  /** @type {string[]} */
  const problems = [];
  for (const id of new Set(ids)) {
    const live = Object.hasOwn(table, id) ? table[id] : undefined;
    if (!live) {
      problems.push(`${id} is not on Anthropic's deprecations page`);
      continue;
    }
    const left = live.retires ? Date.parse(`${live.retires}T00:00:00Z`) - Number(now) : Infinity;
    if (live.state !== "active" || left <= 60 * DAY_MS) {
      problems.push(
        `${id} is ${live.state}${live.retires ? `, retiring ${live.retires}` : ""}; move to its replacement`,
      );
    }
    const ours = modelEntry(id);
    if (ours && (ours.state !== live.state || ours.retires !== live.retires)) {
      problems.push(
        `MODELS says ${id} is ${ours.state}${ours.retires ? ` until ${ours.retires}` : ""}, the page says ${live.state}${live.retires ? ` until ${live.retires}` : ""}; refresh MODELS`,
      );
    }
  }
  return problems;
}

/** Whether a model can still be called: "retired", "retiring" within 60 days, "ok", or "unknown" (not in MODELS).
 * @param {string} id
 * @param {Date | number} [now]
 * @returns {{ status: "ok" | "retiring" | "retired" | "unknown"; retires: string | null }}
 */
export function modelStatus(id, now = Date.now()) {
  const entry = modelEntry(id);
  if (!entry) return { status: "unknown", retires: null };
  if (entry.state === "retired") return { status: "retired", retires: entry.retires };
  if (!entry.retires) return { status: "ok", retires: null };
  const left = Date.parse(`${entry.retires}T00:00:00Z`) - Number(now);
  return {
    status: left <= 0 ? "retired" : left <= 60 * DAY_MS ? "retiring" : "ok",
    retires: entry.retires,
  };
}

/** @param {string} id */
export function modelEntry(id) {
  return Object.hasOwn(MODELS, id) ? MODELS[id] : undefined;
}
