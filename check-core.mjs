/** The shared leaf of the header check: the registry entry a check grades against, the result recorder, declared deviations and the policy parser. */

import { FAMILY_DEVIATIONS, SITE_DEVIATIONS } from "./sites-deviations.mjs";
import { SITES, siteEntry } from "./sites-values.mjs";

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
export function registryEntry(site) {
  const values = typeof site === "string" ? siteEntry(site) : SITES.find((s) => s === site);
  if (!values) return typeof site === "object" ? site : undefined;
  const deviations = /** @type {Record<string, import("./sites.mjs").SiteEntry["deviations"]>} */ (
    SITE_DEVIATIONS
  )[values.id];
  return deviations ? { ...values, deviations } : values;
}

/** @import { CheckResult } from "./check.mjs" */

/**
 * A failed result an entry or the family declined, as the reason, or "". Only declinable results are looked up:
 * K1's cookie prefix, S2, C3, C7, C9, I3, and the family's (FAMILY_DEVIATIONS).
 * @param {CheckedSiteEntry | undefined} entry
 * @param {string} id
 * @param {string} [name] the cookie or thing the result is about, which a deviation's `value` must list when it has one
 * @returns {{ reason: string, family: boolean } | undefined}
 */
export function declined(entry, id, name) {
  const family = /** @type {Record<string, string>} */ (FAMILY_DEVIATIONS)[id];
  if (family) return { reason: family, family: true };
  const own = registryEntry(entry)?.deviations?.[id];
  if (own && (!own.value || (name !== undefined && own.value.includes(name))))
    return { reason: own.reason, family: false };
  return undefined;
}

/**
 * @param {string} policy
 * @returns {Map<string, string[]>} directive name to its sources, lower-cased names
 */
export function parsePolicy(policy) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    // The first occurrence wins, as browsers apply it.
    if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources);
  }
  return out;
}

/**
 * The `result` function a check records its findings with. A failure that `declinable` names (the cookie or thing a
 * declared deviation may cover, or true for the item as a whole) and the entry declares becomes a warning, or a notice
 * for a family deviation; `showDetail` keeps the finding after the reason.
 * @param {CheckResult[]} results
 * @param {ReturnType<typeof registryEntry>} entry
 * @param {boolean} showDetail
 */
export function resultRecorder(results, entry, showDetail) {
  return (
    /** @type {string} */ id,
    /** @type {string} */ name,
    /** @type {boolean} */ pass,
    /** @type {string} */ detail,
    warn = false,
    /** @type {string | boolean} */ declinable = false,
  ) => {
    const deviation =
      !pass && declinable
        ? declined(entry, id, typeof declinable === "string" ? declinable : undefined)
        : undefined;
    if (deviation)
      results.push({
        id,
        name,
        pass,
        detail: `declared deviation: ${deviation.reason}${showDetail ? ` (${detail})` : ""}`,
        ...(deviation.family ? { notice: true } : { warn: true }),
      });
    else results.push({ id, name, pass, detail, ...(warn ? { warn } : {}) });
  };
}
