/** The one check on AI-written prose and the one measure of an author's voice (prose.mjs). */

export type Severity = "critical" | "high" | "medium" | "low";
export type ProseContext = "general" | "technical" | "marketing" | "personal";
export type ProseIssue = { check: string; message: string; excerpt: string | null; line: number | null; severity: Severity };

export declare const NOT_JUST: RegExp[];
/** Stock phrases of a model writing to a customer; pass as `phrases` for an email. */
export declare const EMAIL_PHRASES: string[];
/** What a model is told before it writes; callers add the author's excerpts and guide. */
export declare const WRITING_RULES: string;

/**
 * Every habit in `text`, each with the words it concerns and its line: the avoid-ai-writing engine's findings, "not X,
 * it's Y", a paragraph closing on a list of three, the caller's `phrases`, and each dash unless `dashes: "allow"`. Words in
 * `allow` are dropped from every source. `firstLine` is the file line `text` starts on.
 */
export function checkProse(
  text: string,
  options?: { context?: ProseContext; phrases?: string[]; allow?: string[]; dashes?: "flag" | "allow"; firstLine?: number },
): ProseIssue[];

/** `usual` is the 90th percentile of the author's own chunks' distance from their mean (absent on older stored profiles). */
export type Profile = { mean: Record<string, number>; spread: Record<string, number>; chunks: number; words: number; usual?: number };
export type FeatureReading = { name: string; value: number; mean: number; z: number };
export type VoiceReading = { distance: number; furthest: FeatureReading[] };

/** The profile of the author's passages, or null under three chunks of about 300 words. */
export function profileOf(passages: string[]): Profile | null;
/** How far `text` reads from the profile, with its three furthest features; null under 250 words. */
export function distanceFrom(profile: Profile, text: string): VoiceReading | null;
/** The `count` (default 5) excerpts of about 300 words, one per passage, that read most like the author's usual style. */
export function nearestPassages(profile: Profile, passages: string[], count?: number): string[];
export declare const VOICE_THRESHOLD: number;
/** Where a text starts to read unlike this author: their own range, never under VOICE_THRESHOLD. */
export function thresholdFor(profile: Profile): number;
/** Runs of at least `minWords` (default 8) words that `text` copies word for word from one of `sources`. */
export function copiedRuns(text: string, sources: string[], minWords?: number): string[];
export function describeFeature(f: FeatureReading): string;
