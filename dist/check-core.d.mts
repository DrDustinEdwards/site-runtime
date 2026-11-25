/** @import { Deviation, ServedSiteEntry } from "./sites.mjs" */
/**
 * A served entry with its deviations' reasons, as the check reads it (sites-deviations.mjs).
 * @typedef {ServedSiteEntry & {
 * deviations?: Readonly<Record<string, Deviation>>;
 * }} CheckedSiteEntry
 */
/**
 * The entry a check grades against: by id, or the registry's own entry with the deviations it leaves out; any
 * other object as it is.
 * @param {string | CheckedSiteEntry | undefined} site
 * @returns {CheckedSiteEntry | undefined}
 */
export function registryEntry(site: string | CheckedSiteEntry | undefined): CheckedSiteEntry | undefined;
/**
 * @typedef {{ id: string, name: string, pass: boolean, detail: string, warn?: boolean, notice?: boolean }} CheckResult
 *   `warn`: advice, or an item the site declared a deviation for; `notice`: an item no family site can meet
 *   (FAMILY_DEVIATIONS). Neither fails anything.
 */
/**
 * A failed result an entry or the family declined, as the reason, or "". Only declinable results are looked up:
 * K1's cookie prefix, S2, C3, C7, C9, I3, and the family's (FAMILY_DEVIATIONS).
 * @param {CheckedSiteEntry | undefined} entry
 * @param {string} id
 * @param {string} [name] the cookie or thing the result is about, which a deviation's `value` must list when it has one
 * @returns {{ reason: string, family: boolean } | undefined}
 */
export function declined(entry: CheckedSiteEntry | undefined, id: string, name?: string): {
    reason: string;
    family: boolean;
} | undefined;
/**
 * @param {string} policy
 * @returns {Map<string, string[]>} directive name to its sources, lower-cased names
 */
export function parsePolicy(policy: string): Map<string, string[]>;
/**
 * The `result` function a check records its findings with. A failure that `declinable` names (the cookie or thing a
 * declared deviation may cover, or true for the item as a whole) and the entry declares becomes a warning, or a notice
 * for a family deviation; `showDetail` keeps the finding after the reason.
 * @param {CheckResult[]} results
 * @param {ReturnType<typeof registryEntry>} entry
 * @param {boolean} showDetail
 */
export function resultRecorder(results: CheckResult[], entry: ReturnType<typeof registryEntry>, showDetail: boolean): (
/** @type {string} */ id: string, 
/** @type {string} */ name: string, 
/** @type {boolean} */ pass: boolean, 
/** @type {string} */ detail: string, warn?: boolean, 
/** @type {string | boolean} */ declinable?: string | boolean) => void;
/**
 * A served entry with its deviations' reasons, as the check reads it (sites-deviations.mjs).
 */
export type CheckedSiteEntry = ServedSiteEntry & {
    deviations?: Readonly<Record<string, Deviation>>;
};
/**
 * `warn`: advice, or an item the site declared a deviation for; `notice`: an item no family site can meet
 * (FAMILY_DEVIATIONS). Neither fails anything.
 */
export type CheckResult = {
    id: string;
    name: string;
    pass: boolean;
    detail: string;
    warn?: boolean;
    notice?: boolean;
};
import type { ServedSiteEntry } from "./sites.mjs";
import type { Deviation } from "./sites.mjs";
