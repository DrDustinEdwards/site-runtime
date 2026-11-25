/** @param {string} text */
export function words(text: string): [] | RegExpMatchArray;
/** @param {string} text */
export function sentences(text: string): string[];
/** @param {number} count @param {number} total */
export function per1000(count: number, total: number): number;
/** Cuts text into runs of about CHUNK_WORDS words, on paragraph boundaries where it can. @param {string} text */
export function chunks(text: string): string[];
/**
 * The profile of the author's passages, or null when there is too little of their text to compare with.
 * @param {string[]} passages
 * @returns {Profile | null}
 */
export function profileOf(passages: string[]): Profile | null;
/**
 * Where a text starts to read unlike this author: the edge of their own range (a profile's `usual`), and never closer
 * than VOICE_THRESHOLD. An author who writes both lab notes and essays has a wide range, so a methods note is not
 * flagged against the mix.
 * @param {Profile} profile
 */
export function thresholdFor(profile: Profile): number;
/**
 * How far `text` reads from the profile (the mean of each feature's distance in standard deviations, each capped at
 * MAX_Z so one habit cannot outweigh the rest), with the three furthest features; null when `text` is too short.
 * @param {Profile} profile
 * @param {string} text
 * @returns {VoiceReading | null}
 */
export function distanceFrom(profile: Profile, text: string): VoiceReading | null;
/**
 * The `count` excerpts (about 300 words each, cut on paragraph boundaries) that read most like the author's usual
 * style: the examples to hand a model before it writes.
 * @param {Profile} profile
 * @param {string[]} passages
 * @param {number} [count]
 * @returns {string[]}
 */
export function nearestPassages(profile: Profile, passages: string[], count?: number): string[];
/**
 * Runs of at least `minWords` words that `text` repeats word for word from one of `sources`: an example the model was
 * told to write like, copied instead. Each run is reported once, longest match first.
 * @param {string} text
 * @param {string[]} sources
 * @param {number} [minWords]
 * @returns {string[]}
 */
export function copiedRuns(text: string, sources: string[], minWords?: number): string[];
/** One feature reading in words, for a flag. @param {FeatureReading} f */
export function describeFeature(f: FeatureReading): string;
/** @param {number[]} sorted @param {number} p */
export function percentile(sorted: number[], p: number): number;
/**
 * The least distance at which a text counts as reading unlike the passages (thresholdFor widens it to the author's own
 * range). Set between the fixtures in test/prose.test.mjs (measured
 * 2026-10-24: the passages themselves 0.46 to 0.54, the same register not in them 0.78, a public-domain passage by
 * Henry James 1.47). An app recalibrates once it holds the author's own text: the fixtures stand in for it.
 */
export const VOICE_THRESHOLD: 1.1;
export type Features = Record<string, number>;
export type Profile = {
    mean: Features;
    spread: Features;
    chunks: number;
    words: number;
    usual?: number;
};
export type FeatureReading = {
    name: string;
    value: number;
    mean: number;
    z: number;
};
export type VoiceReading = {
    distance: number;
    furthest: FeatureReading[];
};
