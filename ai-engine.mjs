/**
 * Which engine does a piece of AI work: Dustin's Claude subscription (a Claude Code routine, async) or the Anthropic
 * API (a direct call, sync). One master setting, an optional setting per feature, and a monthly API cap. A site keeps
 * the settings where it likes; this module only decides and runs.
 *
 * - `subscription`: fire the routine. Never falls back.
 * - `api`: call the API.
 * - `auto`: fire the routine; when it certainly started nothing (rate limited, unavailable, unreachable, refused),
 *   call the API instead. An `unknown` fire (a session may exist) never falls back, so one job is never done twice.
 * - A feature setting of `follow` uses the master.
 * - An override ({ engine, until }) beats both until its date: "the subscription is low, use the API until Sunday".
 * - API cap: once the month's API spend reaches `apiCapMicros`, the API is closed; `api` uses the routine instead when
 *   there is one, and `auto` stops falling back. No cap (0 or unset) means no limit. An override in force lifts the cap
 *   until its date: choosing the API for a few days is choosing to pay for it.
 *
 * Subscription usage is not readable (claude.ai/settings/usage is the only meter), so `auto` reacts to a refusal; it
 * cannot see remaining quota.
 */

export const ENGINES = Object.freeze(["subscription", "api", "auto"]);

/** @param {unknown} value */
const isEngine = (value) => typeof value === "string" && ENGINES.includes(value);

/**
 * Settings from whatever a site stored, with anything unreadable dropped.
 * @param {unknown} raw
 */
export function normalizeSettings(raw) {
  const r =
    raw !== null && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const features = /** @type {Record<string, string>} */ ({});
  const given =
    r.features !== null && typeof r.features === "object"
      ? /** @type {Record<string, unknown>} */ (r.features)
      : {};
  for (const [feature, engine] of Object.entries(given)) {
    if (isEngine(engine)) features[feature] = /** @type {string} */ (engine);
  }
  const cap = Number(r.apiCapMicros);
  const o =
    r.override !== null && typeof r.override === "object"
      ? /** @type {Record<string, unknown>} */ (r.override)
      : {};
  const until = typeof o.until === "string" ? Date.parse(o.until) : NaN;
  const override =
    isEngine(o.engine) && Number.isFinite(until)
      ? { engine: /** @type {string} */ (o.engine), until: new Date(until).toISOString() }
      : null;
  return {
    override,
    master: isEngine(r.master) ? /** @type {string} */ (r.master) : "auto",
    features,
    apiCapMicros: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 0,
  };
}

/**
 * The engine setting that applies to a feature: a standing override first, then its own setting, else the master.
 * @param {{ master: string, features: Record<string, string>, override?: { engine: string, until: string } | null }} settings
 * @param {string} feature
 * @param {number} [now]
 */
export function engineFor(settings, feature, now = Date.now()) {
  if (settings.override && Date.parse(settings.override.until) > now)
    return settings.override.engine;
  const own = settings.features[feature];
  return isEngine(own) ? own : settings.master;
}

// Anthropic's list prices in US dollars per million tokens, from platform.claude.com/docs/en/about-claude/pricing,
// read 2026-11-11 (Haiku 5.5 for prompts up to 100,000 tokens; cache writes at the five-minute rate). Keyed like
// anthropic.mjs MODELS. Refresh from that page; never type a price from memory.
export const PRICES_CHECKED = "2026-11-11";
/** @type {Readonly<Record<string, Readonly<{ input: number, output: number, cacheWrite: number, cacheRead: number }>>>} */
export const PRICES = Object.freeze({
  "claude-haiku-5-5": Object.freeze({
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
  }),
  "claude-sonnet-5": Object.freeze({ input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }),
  "claude-opus-5-5": Object.freeze({ input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }),
  "claude-opus-4-8": Object.freeze({ input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }),
  "claude-haiku-4-5-20251001": Object.freeze({
    input: 1,
    output: 5,
    cacheWrite: 1.25,
    cacheRead: 0.1,
  }),
});

/**
 * The listed price of a model id: exact, else the dated id it names ("claude-haiku-4-5" for "claude-haiku-4-5-20251001"),
 * else the undated id a dated one snapshots. Null when none is listed.
 * @param {string} model
 */
export function priceOf(model) {
  if (PRICES[model]) return PRICES[model];
  const base = model.replace(/-\d{8}$/, "");
  const key = Object.keys(PRICES).find((k) => k === base || k.replace(/-\d{8}$/, "") === base);
  return key ? PRICES[key] : null;
}

/**
 * What one call cost, in millionths of a dollar, or null for a model with no listed price.
 * @param {string} model
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite: number }} usage
 */
export function costMicros(model, usage) {
  const p = priceOf(model);
  if (!p) return null;
  // $ per million tokens x tokens = micro-dollars exactly.
  return Math.round(
    usage.input * p.input +
      usage.output * p.output +
      usage.cacheWrite * p.cacheWrite +
      usage.cacheRead * p.cacheRead,
  );
}

// A routine fire that certainly started nothing, so doing the job another way cannot double it.
const NOT_STARTED = new Set(["rate_limited", "unavailable", "unreachable", "refused"]);

/**
 * Runs one job on the engine its feature's setting names.
 *
 * `routine` and `api` are the site's own closures (the routine's fireOnce with its prompt, the API's messages or
 * structured call), so the prompt and the result are the site's and the engine choice is this module's. Leave one out
 * when the site has no such path for this job.
 *
 * @param {{
 *   settings: { master: string, features: Record<string, string>, apiCapMicros: number, override?: { engine: string, until: string } | null },
 *   feature: string,
 *   now?: number,
 *   spentMicros?: number,
 *   routine?: () => Promise<any>,
 *   api?: () => Promise<any>,
 * }} job
 * @returns {Promise<
 *   | { ok: true, engine: "subscription", fire: any, fellBack: null }
 *   | { ok: true, engine: "api", result: any, fellBack: string | null }
 *   | { ok: false, engine: "subscription" | "api" | null, error: string, fire?: any, result?: any, fellBack: string | null }
 * >}
 */
export async function runAi(job) {
  const { settings, feature, spentMicros = 0, routine, api, now = Date.now() } = job;
  const chosen = engineFor(settings, feature, now);
  const overridden = settings.override ? Date.parse(settings.override.until) > now : false;
  const capped = !overridden && settings.apiCapMicros > 0 && spentMicros >= settings.apiCapMicros;

  /** @param {string | null} fellBack */
  const viaApi = async (fellBack) => {
    const result = await /** @type {() => Promise<any>} */ (api)();
    return result.ok
      ? { ok: /** @type {const} */ (true), engine: /** @type {const} */ ("api"), result, fellBack }
      : {
          ok: /** @type {const} */ (false),
          engine: /** @type {const} */ ("api"),
          error: result.error,
          result,
          fellBack,
        };
  };
  const viaRoutine = async () => {
    const fire = await /** @type {() => Promise<any>} */ (routine)();
    return fire.ok
      ? {
          ok: /** @type {const} */ (true),
          engine: /** @type {const} */ ("subscription"),
          fire,
          fellBack: null,
        }
      : {
          ok: /** @type {const} */ (false),
          engine: /** @type {const} */ ("subscription"),
          error: fire.error,
          fire,
          fellBack: null,
        };
  };

  if (chosen === "subscription") {
    if (!routine)
      return {
        ok: false,
        engine: null,
        error: `${feature} has no subscription route.`,
        fellBack: null,
      };
    return viaRoutine();
  }

  if (chosen === "api") {
    if (capped) {
      if (routine) return viaRoutine();
      return { ok: false, engine: null, error: "This month's API cap is reached.", fellBack: null };
    }
    if (!api)
      return { ok: false, engine: null, error: `${feature} has no API route.`, fellBack: null };
    return viaApi(null);
  }

  // auto
  if (!routine) {
    if (!api || capped)
      return { ok: false, engine: null, error: `${feature} has no route open.`, fellBack: null };
    return viaApi("no subscription route");
  }
  const first = await viaRoutine();
  if (first.ok || !api || capped) return first;
  const outcome = first.fire?.outcome;
  if (!NOT_STARTED.has(outcome)) return first;
  const second = await viaApi(outcome);
  return second;
}
