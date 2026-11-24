/**
 * Settings from whatever a site stored, with anything unreadable dropped.
 * @param {unknown} raw
 * @returns {EngineSettings}
 */
export function normalizeSettings(raw: unknown): EngineSettings;
/**
 * The engine setting that applies to a feature: a standing override first, then its own setting, else the master.
 * @param {Pick<EngineSettings, "master" | "features"> & { override?: EngineSettings["override"] }} settings
 * @param {string} feature
 * @param {number} [now]
 * @returns {Engine}
 */
export function engineFor(settings: Pick<EngineSettings, "master" | "features"> & {
    override?: EngineSettings["override"];
}, feature: string, now?: number): Engine;
/**
 * The listed price of a model id: exact, else the dated id it names ("claude-haiku-4-5" for "claude-haiku-4-5-20251001"),
 * else the undated id a dated one snapshots. Null when none is listed.
 * @param {string} model
 */
export function priceOf(model: string): Readonly<Rates & {
    long?: Readonly<Rates & {
        above: number;
    }>;
}> | null;
/** Every input token of a request: the page counts cache reads and both cache writes toward its prompt length. */
export function promptOf(u: Counts): number;
/**
 * What one call cost, in millionths of a dollar, or null for a model with no listed price. `cacheWrite` counts
 * 5-minute cache writes and `cacheWrite1h` one-hour ones. A model with a `long` price is priced per request: when
 * `usage.long` is present (anthropic.mjs sets it on a call of several requests) it holds the requests whose prompt
 * passed the threshold, and the rest pay the standard price; without it the usage is one request, and its whole prompt
 * decides.
 * @param {string} model
 * @param {Counts & { long?: Counts }} usage
 */
export function costMicros(model: string, usage: Counts & {
    long?: Counts;
}): number | null;
/**
 * Runs one job on the engine its feature's setting names.
 *
 * `routine` and `api` are the site's own closures (the routine's fireOnce with its prompt, the API's messages or
 * structured call), so the prompt and the result are the site's and the engine choice is this module's. Leave one out
 * when the site has no such path for this job.
 *
 * @param {{
 *   settings: EngineSettings,
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
export function runAi(job: {
    settings: EngineSettings;
    feature: string;
    now?: number;
    spentMicros?: number;
    routine?: () => Promise<any>;
    api?: () => Promise<any>;
}): Promise<{
    ok: true;
    engine: "subscription";
    fire: any;
    fellBack: null;
} | {
    ok: true;
    engine: "api";
    result: any;
    fellBack: string | null;
} | {
    ok: false;
    engine: "subscription" | "api" | null;
    error: string;
    fire?: any;
    result?: any;
    fellBack: string | null;
}>;
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
/** @import { FireOnceResult, FireResult } from "./routine.mjs" */
/**
 * Which engine does a piece of AI work: the subscription (a routine) or the API (ai-engine.mjs).
 * @typedef {"subscription" | "api" | "auto"} Engine
 */
/**
 * @typedef {object} EngineSettings
 * @property {Engine} master The engine for every feature that has no setting of its own. Default "auto".
 * @property {Record<string, Engine>} features A feature's own engine; a feature missing here follows the master.
 * @property {{ engine: Engine; until: string } | null} override Beats every other setting until `until` (an ISO time): "the subscription is low, use the API until Sunday".
 * @property {number} apiCapMicros The month's API spend, in millionths of a dollar, at which the API closes. 0: no cap.
 */
/**
 * A model's price; `long` is what a request pays once its whole prompt passes `long.above` tokens.
 * @typedef {Readonly<Rates & { long?: Readonly<Rates & { above: number }> }>} Price
 */
/**
 * @typedef {object} CostCounts
 * @property {number} input
 * @property {number} output
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number} [cacheWrite1h]
 */
/**
 * @template {{ ok: boolean; error?: string }} [A={ ok: boolean; error?: string }]
 * @typedef {object} AiJob
 * @property {EngineSettings} settings
 * @property {string} feature
 * @property {number} [now] The time to judge an override against, in ms. Default now.
 * @property {number} [spentMicros] The API spend so far this month, in millionths of a dollar.
 * @property {() => Promise<FireResult | FireOnceResult>} [routine] Fires the site's routine (fireOnce); leave out when the job has no subscription route.
 * @property {() => Promise<A>} [api] Calls the API (messages or structured); leave out when the job has no API route.
 */
/**
 * @template {{ ok: boolean; error?: string }} [A={ ok: boolean; error?: string }]
 * @typedef {| { ok: true; engine: "subscription"; fire: FireResult | FireOnceResult; fellBack: null }
 * | { ok: true; engine: "api"; result: A; fellBack: string | null }
 * | {
 *     ok: false;
 *     engine: "subscription" | "api" | null;
 *     error: string;
 *     fire?: FireResult | FireOnceResult;
 *     result?: A;
 *     fellBack: string | null;
 *   }} AiRun
 */
/** @type {readonly Engine[]} */
export const ENGINES: readonly Engine[];
export const PRICES_CHECKED: "2026-11-13";
/**
 * @typedef {{ input: number, output: number, cacheWrite: number, cacheWrite1h: number, cacheRead: number }} Rates
 * @type {Readonly<Record<string, Readonly<Rates & { long?: Readonly<Rates & { above: number }> }>>>}
 */
export const PRICES: Readonly<Record<string, Readonly<Rates & {
    long?: Readonly<Rates & {
        above: number;
    }>;
}>>>;
export type Counts = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h?: number;
};
/**
 * Which engine does a piece of AI work: the subscription (a routine) or the API (ai-engine.mjs).
 */
export type Engine = "subscription" | "api" | "auto";
export type EngineSettings = {
    /**
     * The engine for every feature that has no setting of its own. Default "auto".
     */
    master: Engine;
    /**
     * A feature's own engine; a feature missing here follows the master.
     */
    features: Record<string, Engine>;
    /**
     * Beats every other setting until `until` (an ISO time): "the subscription is low, use the API until Sunday".
     */
    override: {
        engine: Engine;
        until: string;
    } | null;
    /**
     * The month's API spend, in millionths of a dollar, at which the API closes. 0: no cap.
     */
    apiCapMicros: number;
};
/**
 * A model's price; `long` is what a request pays once its whole prompt passes `long.above` tokens.
 */
export type Price = Readonly<Rates & {
    long?: Readonly<Rates & {
        above: number;
    }>;
}>;
export type CostCounts = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h?: number | undefined;
};
export type AiJob<A extends {
    ok: boolean;
    error?: string;
} = {
    ok: boolean;
    error?: string;
}> = {
    settings: EngineSettings;
    feature: string;
    /**
     * The time to judge an override against, in ms. Default now.
     */
    now?: number | undefined;
    /**
     * The API spend so far this month, in millionths of a dollar.
     */
    spentMicros?: number | undefined;
    /**
     * Fires the site's routine (fireOnce); leave out when the job has no subscription route.
     */
    routine?: (() => Promise<FireResult | FireOnceResult>) | undefined;
    /**
     * Calls the API (messages or structured); leave out when the job has no API route.
     */
    api?: (() => Promise<A>) | undefined;
};
export type AiRun<A extends {
    ok: boolean;
    error?: string;
} = {
    ok: boolean;
    error?: string;
}> = {
    ok: true;
    engine: "subscription";
    fire: FireResult | FireOnceResult;
    fellBack: null;
} | {
    ok: true;
    engine: "api";
    result: A;
    fellBack: string | null;
} | {
    ok: false;
    engine: "subscription" | "api" | null;
    error: string;
    fire?: FireResult | FireOnceResult;
    result?: A;
    fellBack: string | null;
};
export type Rates = {
    input: number;
    output: number;
    cacheWrite: number;
    cacheWrite1h: number;
    cacheRead: number;
};
import type { FireResult } from "./routine.mjs";
import type { FireOnceResult } from "./routine.mjs";
