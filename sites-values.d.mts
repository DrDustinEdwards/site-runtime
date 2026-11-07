/**
 * The registry's values (sites-values.mjs, written by update-sites-values.mjs from sites.mjs): what `./sites` serves.
 * Everything sites.mjs exports but FAMILY_DEVIATIONS, which only the check reads, from sites-deviations.mjs. The values
 * carry no reasons (those are sites-deviations.mjs too), so they are ServedSiteEntry, which leaves `reason` out.
 */
import type { ServedSiteEntry } from "./sites.mjs";
export type { ServedSiteEntry, SignInProbes, SiteAssets, SiteOptIns } from "./sites.mjs";
export { PASSKEY_OVERRIDES, permissionsAllowingSelf } from "./headers.mjs";
import type { HeaderOverride } from "./headers.mjs";

/** One export per entry, so a Worker bundles only its own. */
export const dustinedwardsInfo: ServedSiteEntry,
  foxhound: ServedSiteEntry,
  foxing: ServedSiteEntry,
  germomics: ServedSiteEntry,
  julieedwardsInfo: ServedSiteEntry,
  bsw: ServedSiteEntry,
  txasm: ServedSiteEntry,
  carrel: ServedSiteEntry,
  carrelDesk: ServedSiteEntry,
  capsidPortal: ServedSiteEntry,
  capsidMcp: ServedSiteEntry,
  carrelMcp: ServedSiteEntry,
  capsid: ServedSiteEntry,
  enarratio: ServedSiteEntry,
  foxhoundMcp: ServedSiteEntry,
  dustinedwardsMcp: ServedSiteEntry,
  foxingMcp: ServedSiteEntry,
  capsomer: ServedSiteEntry,
  prelum: ServedSiteEntry;
export const SITES: readonly ServedSiteEntry[];
/** The entry for an id; an unknown id throws. */
export function siteEntry(id: string): ServedSiteEntry;
/** The entry whose origin or alias is `origin`, or undefined. */
export function siteForOrigin(origin: string): ServedSiteEntry | undefined;
/** PASSKEY_OVERRIDES when the entry opts into passkey, then its own overrides. */
export function siteOverrides(id: string): Record<string, HeaderOverride>;
