/** Which engine does a piece of AI work: the subscription (a routine) or the API (ai-engine.mjs). */

export type Engine = "subscription" | "api" | "auto";
export const ENGINES: readonly Engine[];

export type EngineSettings = {
  /** The engine for every feature that has no setting of its own. Default "auto". */
  master: Engine;
  /** A feature's own engine; a feature missing here follows the master. */
  features: Record<string, Engine>;
  /** Beats every other setting until `until` (an ISO time): "the subscription is low, use the API until Sunday". */
  override: { engine: Engine; until: string } | null;
  /** The month's API spend, in millionths of a dollar, at which the API closes. 0: no cap. */
  apiCapMicros: number;
};

/** Settings from whatever a site stored; anything unreadable is dropped. */
export function normalizeSettings(raw: unknown): EngineSettings;

/** The engine a feature uses: its own setting, else the master. */
export function engineFor(
  settings: Pick<EngineSettings, "master" | "features"> & { override?: EngineSettings["override"] },
  feature: string,
  now?: number,
): Engine;

export const PRICES_CHECKED: string;
export const PRICES: Readonly<
  Record<string, Readonly<{ input: number; output: number; cacheWrite: number; cacheRead: number }>>
>;

/** What one call cost in millionths of a dollar, or null for a model with no listed price. */
export function costMicros(
  model: string,
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number | null;

import type { FireOnceResult, FireResult } from "./routine.mjs";

export type AiJob<A extends { ok: boolean; error?: string } = { ok: boolean; error?: string }> = {
  settings: EngineSettings;
  feature: string;
  /** The time to judge an override against, in ms. Default now. */
  now?: number;
  /** The API spend so far this month, in millionths of a dollar. */
  spentMicros?: number;
  /** Fires the site's routine (fireOnce); leave out when the job has no subscription route. */
  routine?: () => Promise<FireResult | FireOnceResult>;
  /** Calls the API (messages or structured); leave out when the job has no API route. */
  api?: () => Promise<A>;
};

export type AiRun<A extends { ok: boolean; error?: string } = { ok: boolean; error?: string }> =
  | { ok: true; engine: "subscription"; fire: FireResult | FireOnceResult; fellBack: null }
  | { ok: true; engine: "api"; result: A; fellBack: string | null }
  | {
      ok: false;
      engine: "subscription" | "api" | null;
      error: string;
      fire?: FireResult | FireOnceResult;
      result?: A;
      fellBack: string | null;
    };

/** Runs a job on its feature's engine. `fellBack` names why `auto` used the API (the routine's outcome). */
export function runAi<A extends { ok: boolean; error?: string }>(job: AiJob<A>): Promise<AiRun<A>>;
