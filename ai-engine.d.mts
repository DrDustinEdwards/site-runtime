/** Which engine does a piece of AI work: the subscription (a routine) or the API (ai-engine.mjs). */

export type Engine = "subscription" | "api" | "auto";
export const ENGINES: readonly Engine[];

export type EngineSettings = {
  /** The engine for every feature that has no setting of its own. Default "auto". */
  master: Engine;
  /** A feature's own engine; a feature missing here follows the master. */
  features: Record<string, Engine>;
  /** The month's API spend, in millionths of a dollar, at which the API closes. 0: no cap. */
  apiCapMicros: number;
};

/** Settings from whatever a site stored; anything unreadable is dropped. */
export function normalizeSettings(raw: unknown): EngineSettings;

/** The engine a feature uses: its own setting, else the master. */
export function engineFor(
  settings: Pick<EngineSettings, "master" | "features">,
  feature: string,
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

export type AiJob = {
  settings: EngineSettings;
  feature: string;
  /** The API spend so far this month, in millionths of a dollar. */
  spentMicros?: number;
  /** Fires the site's routine (fireOnce); leave out when the job has no subscription route. */
  routine?: () => Promise<{
    ok: boolean;
    outcome?: string;
    error?: string;
    [key: string]: unknown;
  }>;
  /** Calls the API (messages or structured); leave out when the job has no API route. */
  api?: () => Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
};

export type AiRun =
  | { ok: true; engine: "subscription"; fire: any; fellBack: null }
  | { ok: true; engine: "api"; result: any; fellBack: string | null }
  | {
      ok: false;
      engine: "subscription" | "api" | null;
      error: string;
      fire?: any;
      result?: any;
      fellBack: string | null;
    };

/** Runs a job on its feature's engine. `fellBack` names why `auto` used the API (the routine's outcome). */
export function runAi(job: AiJob): Promise<AiRun>;
