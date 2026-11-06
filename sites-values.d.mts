/**
 * The registry's values (sites-values.mjs, written by update-sites-values.mjs from sites.mjs): what `./sites` serves.
 * Everything sites.mjs exports but FAMILY_DEVIATIONS, which only the check reads, from sites-deviations.mjs.
 */
export type { Deviation, SignInProbes, SiteAssets, SiteEntry, SiteOptIns } from "./sites.mjs";
export {
    PASSKEY_OVERRIDES, permissionsAllowingSelf,
    dustinedwardsInfo, foxhound, foxing, germomics, julieedwardsInfo, bsw, txasm, carrel, carrelDesk, capsidPortal, capsidMcp, carrelMcp,
    capsid, enarratio, foxhoundMcp, dustinedwardsMcp, foxingMcp, germomicsMcp, capsomer, prelum,
    SITES, siteEntry, siteForOrigin, siteOverrides,
} from "./sites.mjs";
