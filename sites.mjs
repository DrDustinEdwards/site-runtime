/**
 * The site registry: one entry per live site, holding only where it departs from the bar and why. The header builder
 * (`buildSecurityHeaders({ site })`), the check (`checkSecurityHeaders(headers, { site })`) and the live check
 * (bin/site-runtime-security.mjs) all read it, so a site cannot build one set and be graded against another.
 *
 * An entry is filled from the site's own code (the file is named beside it), with the reason that code gives. A
 * deviation an audit marked as a gap is left out on purpose, so the check keeps failing it until the site is fixed:
 * dustinedwards.info's nine-feature Permissions-Policy and one-year HSTS, germomics' wildcard script hosts, and `Cross-Origin-Resource-Policy: cross-origin` on every response (a site marks shared
 * media with corpFor, ./headers, instead).
 *
 * - `headers`: overrides in buildSecurityHeaders' shape, `{ value, reason }`, `value: null` to send none.
 * - `optIns`: the builder options a check must accept, each `{ value, reason }`: cloudflareWebAnalytics (the edge
 *   injects the beacon, so the policy must let it run), inlineScripts, inlineStyles ('unsafe-inline' on style-src),
 *   formTargets, framedBySameOrigin, baseUriSelf, and passkey (publickey-credentials-get=(self) in the
 *   Permissions-Policy, PASSKEY_OVERRIDES). Some are a promise the check then holds the site to: strictDynamic (C3),
 *   trustedTypes (C7, `true` enforced or "report-only"), denyUnlisted (C9, `true` or "report-only"), integrityPolicy
 *   (S2, "enforce" or "report-only", which buildSecurityHeaders writes), coep (I3, which buildSecurityHeaders writes)
 *   and uploads (A3, the path prefix its uploaded files are served under, which the live check samples). A
 *   "report-only" one is met by the site's Report-Only policy (buildStagedPolicy, ./csp) or header, whose reports reach
 *   the sink (./csp-report), the step before enforcing.
 * - `deviations`: a checklist item the site does not meet, by item id, with the reason the site's code gives; the
 *   check then reports it as a warning, not an error. S2, C3, C7, C9 and I3 are graded on every site, so what a site
 *   neither meets nor declines is an error, and the deviations are the whole list of what each site skips. K1's cookie
 *   prefix takes one too, its `value` naming the cookies it covers. FAMILY_DEVIATIONS holds the items no site can meet.
 * - `aliases`: other origins the same Worker answers for, such as the domain it will move to.
 * - `signIn`: what the live sign-in check (`./sign-in-live.mjs`, area 3) probes beyond the site's own /admin and /mcp:
 *   `admin`, more pages that must be gated (a path on the site or a URL on another host), and `mcp`, MCP servers that
 *   must answer 401 with their sign-in metadata. A declared page or server that does not answer is an error.
 * - `oldSite`: the site's real domain while it still serves the live old site the Worker replaces. A site served from
 *   workers.dev is noindexed there while, and only while, it has one (A6, the live check): a workers.dev host with no
 *   old site behind its domain is the site, and noindex would take it out of search.
 * - `assets`: how the static files reach a reader without the Worker, and the `_headers` site-runtime-headers writes
 *   for them (staticHeaders, ./static-site): `skipWorker`, the patterns `run_worker_first` leaves to the asset server;
 *   `policy`, a static site's one page policy (buildContentSecurityPolicy's options beside the policy opt-ins), with
 *   `reportOrigin` when it reports to another host; and `paths`, the headers a path pattern adds (a cache rule, CORP).
 */

import { CSP_REPORT_GROUP, CSP_REPORT_PATH, buildPolicy } from "./csp.mjs";
import { PASSKEY_OVERRIDES, corpFor, entryOverrides, permissionsAllowingSelf } from "./headers.mjs";

export { PASSKEY_OVERRIDES, permissionsAllowingSelf };

const beacon = (/** @type {string} */ where) => ({ value: true, reason: `Cloudflare Web Analytics is on; the edge injects the beacon (${where}).` });
const passkey = { value: true, reason: "The family sign-in offers a passkey (./sign-in)." };
const STRICT_ORIGIN = "strict-origin-when-cross-origin";

// A page that posts a form without JavaScript (the sign-in link's confirm page) sends `Origin: null` under no-referrer,
// and React Router and Better Auth refuse it with a 400, so the emailed link never signs anyone in.
const signInReferrer = {
  value: STRICT_ORIGIN,
  reason: "no-referrer makes browsers send `Origin: null` on same-origin form POSTs, which React Router and Better Auth refuse; the sign-in link's confirm page is one.",
};
const popupSignIn = {
  "Cross-Origin-Opener-Policy": {
    value: null,
    reason: "AI clients (claude.ai among them) open /authorize in a popup and wait for it through window.opener; same-origin would sever that opener and the sign-in would never return.",
  },
};

/**
 * @typedef {import("./headers.mjs").HeaderOverride} HeaderOverride
 * @typedef {{
 *   cloudflareWebAnalytics?: { value: boolean, reason: string },
 *   inlineScripts?: { value: "unsafe-inline", reason: string },
 *   formTargets?: { value: readonly string[], reason: string },
 *   framedBySameOrigin?: { value: boolean, reason: string },
 *   baseUriSelf?: { value: boolean, reason: string },
 *   passkey?: { value: boolean, reason: string },
 *   inlineStyles?: { value: boolean, reason: string },
 *   strictDynamic?: { value: boolean, reason: string },
 *   trustedTypes?: { value: true | "report-only", reason: string },
 *   denyUnlisted?: { value: boolean | "report-only", reason: string },
 *   integrityPolicy?: { value: "enforce" | "report-only", reason: string },
 *   coep?: { value: "credentialless" | "require-corp", reportOnly?: boolean, reason: string },
 *   uploads?: { value: string, reason: string },
 * }} SiteOptIns
 * @typedef {{ reason: string, value?: readonly string[] }} Deviation
 * @typedef {{
 *   skipWorker?: { value: readonly string[], reason: string },
 *   policy?: Omit<import("./csp.mjs").SitePolicy, "reportOnly" | "nonce">,
 *   reportOrigin?: string,
 *   paths?: Readonly<Record<string, Readonly<Record<string, string>>>>,
 * }} SiteAssets
 * @typedef {{
 *   id: string, origin: string, aliases?: readonly string[], oldSite?: { value: string, reason: string },
 *   headers?: Readonly<Record<string, HeaderOverride>>, optIns?: SiteOptIns, deviations?: Readonly<Record<string, Deviation>>,
 *   assets?: SiteAssets, signIn?: SignInProbes,
 * }} SiteEntry
 * @typedef {{ admin?: readonly string[], mcp?: readonly string[] }} SignInProbes
 */

/**
 * The checklist items no site in the family can meet, each with why. The live check reports each as a notice, never
 * an error or a warning, so the reason stays in sight without failing anyone.
 * @type {Readonly<Record<string, string>>}
 */
export const FAMILY_DEVIATIONS = /* @__PURE__ */ Object.freeze({
  T2: "HSTS on the http:// to https:// hop: a browser ignores Strict-Transport-Security sent over plain http (RFC 6797 section 8.1), and on a custom domain that hop is Cloudflare's Always Use HTTPS, a zone setting no Worker answers. The https redirect hops are graded instead.",
  D3: "OpenPGP signing of security.txt: it needs a family signing key that Dustin holds and rotates, and none exists; RFC 9116 section 2.3 recommends a signature, it does not require one. A signed file is graded when one appears.",
  R4: "JSON routes refusing text/plain and form bodies (requireJson, ./body): the live check has no session, and every JSON route a stranger can reach answers 401 before it reads a body, so only the site's own code can show it.",
});

// Area 2 (2026-10-31): what every site is graded on (S2, C3, C7, C9, I3), staged or declined with the reason its code gives.

const coepCredentialless = {
  value: /** @type {const} */ ("credentialless"),
  reason: "The pages embed no frame and load nothing from another origin that needs a cookie (the beacon included).",
};
const coepStaged = (/** @type {string} */ why) => ({ value: /** @type {const} */ ("credentialless"), reportOnly: true, reason: `Report-Only first: ${why}; the coep reports (./csp-report) show what enforcing would refuse.` });
const doorCoep = { value: /** @type {const} */ ("credentialless"), reason: "The door's pages load nothing from another origin (default-src 'none'). Its COOP stays off for the popup sign-in, so this isolates nothing; it refuses what nothing loads." };

const integrityStaged = {
  value: /** @type {const} */ ("report-only"),
  reason: "React Router writes integrity for every chunk into the import map and the modulepreloads (subResourceIntegrity: true, react-router.config.ts), and the edge injects the beacon with its own; Report-Only until the integrity-violation reports show none missing.",
};
const integrityStagedStatic = {
  value: /** @type {const} */ ("report-only"),
  reason: "The build writes its own <script> tags; Report-Only until each carries integrity (integrityHash, ./csp) and crossorigin, which Integrity-Policy needs of a classic script, and the reports show none missing.",
};
const integrityNoScript = { value: /** @type {const} */ ("enforce"), reason: "The door's pages run no script (default-src 'none'), so none lacks integrity." };

const typesStaged = {
  value: /** @type {const} */ ("report-only"),
  reason: "React DOM 19 writes dangerouslySetInnerHTML, and every <script> it creates, through innerHTML with a plain string (react-dom-client), which require-trusted-types-for 'script' refuses unless a policy makes it; the Report-Only policy (buildStagedPolicy) names each sink a page reaches before one is written.",
};
const typesStagedStatic = {
  value: /** @type {const} */ ("report-only"),
  reason: "The Report-Only policy (buildStagedPolicy) names any sink the site's own scripts hand a string to before it is enforced.",
};
const typesNoScript = { value: /** @type {const} */ (true), reason: "The door's pages run no script, so no string reaches a sink." };

const unlistedStaged = {
  value: /** @type {const} */ ("report-only"),
  reason: "default-src 'self' still lets in every kind the policy does not name (the web manifest among them); denyUnlisted in the Report-Only policy (buildStagedPolicy) names each kind a page needs before default-src 'none' is enforced.",
};
const nothingUnlisted = { value: true, reason: "A static site that loads nothing beyond what its policy names: default-src 'none'." };

const beaconNotStrict = {
  reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.",
};

/** The doors' set: no script, nothing loaded, so each promise is met by the policy withMcpHeaders (./mcp-server) writes. */
const doorOptIns = {
  coep: doorCoep,
  integrityPolicy: integrityNoScript,
  trustedTypes: typesNoScript,
  denyUnlisted: { value: true, reason: "The door's policy is default-src 'none': its consent page loads one hashed <style> and nothing else." },
};

const IMMUTABLE = { "Cache-Control": "public, max-age=31536000, immutable" };
/** The build's content-hashed output: Vite's /assets/, and devkit siteScript's /islands/ where a site has them. */
const hashed = (/** @type {string[]} */ ...patterns) => Object.fromEntries(patterns.map((p) => [p, IMMUTABLE]));
const sharedImage = { "Cross-Origin-Resource-Policy": corpFor("image/png") };
const staticPages = (/** @type {string[]} */ patterns, /** @type {string} */ where) => ({
  value: patterns,
  reason: `run_worker_first leaves them to the asset server (${where}), so they take the set from _headers alone.`,
});

/* Each entry is its own export, so a Worker that imports one (`import { germomics } from "./sites"`) bundles that
 * entry alone; the calls are marked pure so a bundler can drop the rest. */

// workers/security-headers.mjs, workers/csp.mjs. COOP is the standard's same-origin: the app opens no popup (no
// window.open in app/ or workers/) and the admin sign-in is a full-page Access redirect.
export const dustinedwardsInfo = {
  id: "dustinedwards-info",
  origin: "https://dustinedwards.info",
  headers: {
    "Referrer-Policy": { value: STRICT_ORIGIN, reason: "The ratified value for this site; OSHP's no-referrer has not been ruled on for it." },
    "Permissions-Policy": {
      value: /* @__PURE__ */ permissionsAllowingSelf("clipboard-write", "screen-wake-lock"),
      reason: "clipboard-write must stay allowed: the copy controls swallow the refusal silently. The procedure run view keeps the screen awake (navigator.wakeLock, app/enhance/run.ts).",
    },
  },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/csp.mjs"),
    coep: {
      value: "credentialless",
      reason: "The pages embed no cross-origin frame (the admin's preview is a sandboxed srcdoc frame, app/components/admin/kb-form.tsx), and the podcast audio and the beacon load without cookies.",
    },
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
    denyUnlisted: unlistedStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    paths: {
      ...hashed("/assets/*", "/islands/*"),
      // Pictures at static paths that other origins load: the share card, and those a page or Carrel's preview draws.
      ...Object.fromEntries(
        ["/diagrams/*", "/phage-hunters/*", "/dustin-edwards-og-image.png", "/dustin-edwards-logo.svg", "/dustin-edwards-logo-dark.svg"].map((p) => [p, sharedImage]),
      ),
    },
  },
  // The lab notebook is admin-only, behind its own Access application (dustinedwards-lab-login).
  signIn: { admin: ["/lab"], mcp: ["https://admin-mcp.dustinedwards.info/mcp"] },
};

// app/lib/http/header-set.ts, app/lib/http/content-security-policy.ts
export const foxhound = {
  id: "foxhound",
  origin: "https://foxhoundapp.com",
  headers: {
    "Referrer-Policy": {
      value: STRICT_ORIGIN,
      reason: "no-referrer makes browsers send `Origin: null` on same-origin POSTs, which Better Auth refuses (MISSING_OR_NULL_ORIGIN); /api/account/switch also returns the merchant to the page they were on from the Referer.",
    },
    "Permissions-Policy": {
      value: /* @__PURE__ */ permissionsAllowingSelf("publickey-credentials-get", "clipboard-write"),
      reason: "Passkey sign-in, and navigator.clipboard.writeText for the blog's Copy link and the payment page's copy-email button; allowed for this origin only.",
    },
  },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("content-security-policy.ts"),
    formTargets: { value: ["https://checkout.stripe.com", "https://connect.stripe.com"], reason: "Stripe Checkout, and Connect OAuth, which /connect's POST redirects to." },
    passkey,
    coep: /* @__PURE__ */ coepStaged("the merchant app returns from Stripe and draws its charts and the admin's pages behind a sign-in"),
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
    denyUnlisted: unlistedStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    paths: {
      // The favicons and PNGs beside a Foxhound link (the RSS channel image) are images other origins load.
      "/*.ico": { "Cross-Origin-Resource-Policy": corpFor("image/x-icon") },
      "/*.png": sharedImage,
      ...hashed("/assets/*", "/islands/*"),
    },
  },
  // The merchants' MCP server on the site, and the admin's on its own host.
  signIn: { mcp: ["https://admin-mcp.foxhoundapp.com/mcp", "https://foxhoundapp.com/mcp"] },
};

// apps/web/workers/security-headers.ts
export const foxing = {
  id: "foxing",
  origin: "https://foxing.app",
  headers: { "Referrer-Policy": signInReferrer },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/security-headers.ts"),
    baseUriSelf: { value: true, reason: "The reader (/read/:slug): Readium writes a same-origin <base> so a book's images and CSS resolve." },
    passkey,
    coep: /* @__PURE__ */ coepStaged("the reader frames each book's pages and loads its covers and fonts"),
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
    denyUnlisted: unlistedStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: { paths: hashed("/assets/*", "/islands/*") },
  signIn: { mcp: ["https://admin-mcp.foxing.app/mcp"] },
};

// app/lib/security-headers.ts
export const germomics = {
  id: "germomics",
  origin: "https://germomics.com",
  headers: {
    "Referrer-Policy": {
      value: STRICT_ORIGIN,
      reason: "no-referrer strips the origin from the player's episode requests through OP3, which tells web players apart by Referer, and blanks Web Analytics' referrers.",
    },
    "Permissions-Policy": {
      value: /* @__PURE__ */ permissionsAllowingSelf("autoplay", "clipboard-write", "web-share"),
      reason: "The player resumes with audio.play() (player-context.tsx); Copy link, the transcript quote and the feed URL use navigator.clipboard.writeText, and Copy link offers navigator.share (CopyLink.tsx).",
    },
  },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("app/lib/security-headers.ts"),
    inlineStyles: { value: true, reason: "TipTap and the data pages' map set inline styles, so styles keep 'unsafe-inline' and the nonce stays off style-src (app/lib/security-headers.ts)." },
    coep: /* @__PURE__ */ coepStaged("the data pages load Google Maps' script, tiles and fonts and the games Phaser's assets, none of which this site controls"),
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
    denyUnlisted: unlistedStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    paths: {
      ...hashed("/assets/*"),
      // The fonts sit at stable names scripts/fetch-fonts.mjs rewrites in place: a day, then the ETag.
      "/fonts/*": { "Cache-Control": "public, max-age=86400" },
    },
  },
};

// workers/security-headers.ts, workers/header-set.ts
export const julieedwardsInfo = {
  id: "julieedwards-info",
  origin: "https://julieedwards.info",
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/security-headers.ts"),
    denyUnlisted: { value: true, reason: "One page that loads its own files, its photos' two hosts and the beacon; the manifest is named." },
    coep: coepCredentialless,
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    paths: {
      "/assets/*": { ...IMMUTABLE, "Cross-Origin-Resource-Policy": corpFor("text/css") },
      "/opengraph-image.png": sharedImage,
    },
  },
};

// workers/security-headers.ts
export const bsw = {
  id: "bsw",
  origin: "https://bsw.dustin-edwards.workers.dev",
  oldSite: { value: "https://biosciencewriters.com", reason: "The old IIS site still answers there until the domain moves to this Worker." },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/security-headers.ts"),
    denyUnlisted: { value: true, reason: "Marketing pages that load their own files, data: images and the beacon; the manifest is named." },
    coep: coepCredentialless,
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: { paths: hashed("/assets/*", "/islands/*", "/brand/*") },
};

// app/lib/security-headers.ts; SITE_ORIGIN is txasm.org (app/lib/site-meta.ts), served from workers.dev until cutover.
// txasm.org itself serves no live site (a suspended host), so the workers.dev host stays indexed (no oldSite).
export const txasm = {
  id: "txasm",
  origin: "https://txasm.dustin-edwards.workers.dev",
  aliases: ["https://txasm.org"],
  headers: { "Referrer-Policy": signInReferrer },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("app/lib/security-headers.ts"),
    passkey,
    coep: /* @__PURE__ */ coepStaged("submission, review, the abstract book's PDF.js viewer and the admin sit behind a sign-in"),
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
    denyUnlisted: unlistedStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: { paths: hashed("/assets/*") },
  // Its Access application covers /admin/access only (app/lib/access.server.ts).
  signIn: { admin: ["/admin/access"] },
};

// www/headers.mjs, www/build.mjs, www/wrangler.jsonc
export const carrel = {
  id: "carrel",
  origin: "https://carrel.dustinedwards.info",
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("www/headers.mjs"),
    denyUnlisted: nothingUnlisted,
    coep: coepCredentialless,
    integrityPolicy: integrityStagedStatic,
    trustedTypes: typesStagedStatic,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    skipWorker: /* @__PURE__ */ staticPages(["/fonts/*"], "www/wrangler.jsonc"),
    policy: { noForms: true, sources: { img: ["data:"] }, styleAttributesInline: true, extraDirectives: ["manifest-src 'self'"] },
    paths: { "/*": { "Cache-Control": "public, max-age=300, must-revalidate" } },
  },
};

// workers/security-headers.ts: the standard exactly, behind Access; the beacon is never injected.
export const carrelDesk = {
  id: "carrel-desk",
  origin: "https://desk.dustinedwards.info",
  optIns: {
    strictDynamic: { value: true, reason: "The nonced entry scripts load the route chunks (workers/security-headers.ts appPolicy)." },
    coep: /* @__PURE__ */ coepStaged("the editor frames each draft's preview, the site's own markup under a sandbox policy, which COEP would refuse unless it carries it too"),
    integrityPolicy: integrityStaged,
    trustedTypes: typesStaged,
    denyUnlisted: unlistedStaged,
  },
  assets: { paths: hashed("/assets/*") },
  // All of Desk is behind Access.
  signIn: { admin: ["/"] },
};

// src/security-headers.ts, src/dashboard-csp.ts
export const capsidPortal = {
  id: "capsid-portal",
  origin: "https://portal.dustinedwards.info",
  optIns: {
    denyUnlisted: { value: true, reason: "The dashboard loads only its own scripts, styles and data: images (src/dashboard-csp.ts)." },
    coep: /* @__PURE__ */ coepStaged("every Portal page sits behind Access"),
    integrityPolicy: { value: "report-only", reason: "The build's tags carry integrity (subresourceIntegrity, ./sri, dashboard/vite.config.ts), but each view is a chunk loaded with import(), which only an import map could give integrity; Report-Only while the reports name them." },
    trustedTypes: typesStaged,
  },
  deviations: {
    C3: { reason: "The dashboard is a Vite build served as files under script-src 'self' (src/dashboard-csp.ts): no nonce or hash for 'strict-dynamic' to start from." },
  },
  // All of the Portal is behind Access for SaaS.
  signIn: { admin: ["/"] },
};

// src/security-headers.ts: its only page is the /authorize consent dialog MCP clients open. Its policy (DEFAULT_CSP and
// the dialog's) is the door's: default-src 'none' and require-trusted-types-for 'script'.
export const capsidMcp = { id: "capsid-mcp", origin: "https://mcp.dustinedwards.info", headers: popupSignIn, optIns: doorOptIns };

// workers/security-headers.ts: Carrel's AI door.
export const carrelMcp = { id: "carrel-mcp", origin: "https://carrel-mcp.dustinedwards.info", headers: popupSignIn, optIns: doorOptIns };

// explorer/src/security-headers.mjs, explorer/wrangler-config.mjs: every file is answered by the asset server.
export const capsid = {
  id: "capsid",
  origin: "https://capsid.dustinedwards.info",
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("explorer/src/security-headers.mjs"),
    denyUnlisted: nothingUnlisted,
    coep: coepCredentialless,
    integrityPolicy: integrityStagedStatic,
    trustedTypes: typesStagedStatic,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    skipWorker: /* @__PURE__ */ staticPages(["/*"], "explorer/wrangler-config.mjs: the Worker answers only paths with no file"),
    policy: {},
    reportOrigin: "https://mcp.dustinedwards.info",
    paths: { "/*": { "Cache-Control": "public, max-age=3600" } },
  },
};

// scripts/security-headers.ts, wrangler.jsonc
export const enarratio = {
  id: "enarratio",
  origin: "https://enarratio.dustinedwards.info",
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("scripts/security-headers.ts"),
    denyUnlisted: { value: true, reason: "The gallery loads its own files, data: images and the beacon, and reports to cloudflareinsights.com." },
    coep: coepCredentialless,
    integrityPolicy: integrityStagedStatic,
    trustedTypes: typesStagedStatic,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    skipWorker: /* @__PURE__ */ staticPages(["/fonts/*"], "wrangler.jsonc"),
    policy: { sources: { img: ["data:"], connect: ["https://cloudflareinsights.com"] } },
    // File names are not hashed (record 0008), so five minutes.
    paths: { "/*": { "Cache-Control": "public, max-age=300, must-revalidate" } },
  },
};

// mcp/src/door.ts: Foxhound's admin AI door.
export const foxhoundMcp = { id: "foxhound-mcp", origin: "https://admin-mcp.foxhoundapp.com", headers: popupSignIn, optIns: doorOptIns };

// dustinedwards-info mcp/src/index.ts: the site's admin MCP.
export const dustinedwardsMcp = { id: "dustinedwards-mcp", origin: "https://admin-mcp.dustinedwards.info", headers: popupSignIn, optIns: doorOptIns };

// foxing mcp/src/index.ts: Foxing's admin MCP, the standard exactly.
export const foxingMcp = { id: "foxing-mcp", origin: "https://admin-mcp.foxing.app", optIns: doorOptIns };

// scripts/security-headers.ts, wrangler.jsonc
export const capsomer = {
  id: "capsomer",
  origin: "https://capsomer.dustinedwards.info",
  headers: {
    "Permissions-Policy": {
      value: /* @__PURE__ */ permissionsAllowingSelf("clipboard-write"),
      reason: "The states pages show the detail panel's and media library's Copy buttons working (navigator.clipboard.writeText).",
    },
    "X-Frame-Options": { value: "sameorigin", reason: "The site frames its own states pages and specimens (site/main.tsx, site/specimen.ts)." },
  },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("scripts/security-headers.ts"),
    framedBySameOrigin: { value: true, reason: "The site frames its own states pages and specimens; no other origin may." },
    coep: /* @__PURE__ */ coepStaged("the site frames its own states pages and specimens, each of which must carry it too"),
    integrityPolicy: { value: "report-only", reason: "The build's tags carry integrity (subresourceIntegrity, ./sri, site/vite.config.ts), but the admin and some states pages load chunks with import(), which only an import map could give integrity; Report-Only while the reports name them." },
    trustedTypes: typesStagedStatic,
    denyUnlisted: unlistedStaged,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    skipWorker: /* @__PURE__ */ staticPages(["/assets/*"], "wrangler.jsonc"),
    policy: { sources: { img: ["data:"], connect: ["https://raw.githubusercontent.com/DrDustinEdwards/capsomer/results/results.json"] } },
    paths: hashed("/assets/*"),
  },
};

// specimen/headers.mjs, wrangler.jsonc
export const prelum = {
  id: "prelum",
  origin: "https://prelum.dustinedwards.info",
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("specimen/headers.mjs"),
    denyUnlisted: nothingUnlisted,
    coep: coepCredentialless,
    integrityPolicy: integrityStagedStatic,
    trustedTypes: typesStagedStatic,
  },
  deviations: { C3: beaconNotStrict },
  assets: {
    skipWorker: /* @__PURE__ */ staticPages(["/fonts/*", "/katex/*", "/images/*", "/diagrams/*"], "wrangler.jsonc"),
    policy: { noForms: true, sources: { img: ["data:"] }, styleAttributesInline: true, extraDirectives: ["manifest-src 'self'"] },
    paths: {
      "/*": { "Cache-Control": "public, max-age=300, must-revalidate" },
      "/elements.json": { "Access-Control-Allow-Origin": "*" },
      // A Mermaid drawing styles itself with an inline <style>, which the page policy refuses when the SVG is opened on its own.
      "/diagrams/*": {
        "Content-Security-Policy": /* @__PURE__ */ buildPolicy([
          "default-src 'none'", "style-src 'unsafe-inline'", "connect-src 'self'", "frame-ancestors 'none'", `report-uri ${CSP_REPORT_PATH}`, `report-to ${CSP_REPORT_GROUP}`,
        ]),
      },
    },
  },
};

/** @type {readonly SiteEntry[]} */
export const SITES = /* @__PURE__ */ Object.freeze([
  dustinedwardsInfo, foxhound, foxing, germomics, julieedwardsInfo, bsw, txasm, carrel, carrelDesk, capsidPortal, capsidMcp, carrelMcp, capsid, enarratio,
  foxhoundMcp, dustinedwardsMcp, foxingMcp, capsomer, prelum,
]);

/**
 * The entry for an id; unknown ids throw, so a typo never grades a site against the bare standard.
 * @param {string} id
 * @returns {SiteEntry}
 */
export function siteEntry(id) {
  const entry = SITES.find((s) => s.id === id);
  if (!entry) throw new Error(`${JSON.stringify(id)} is not in the site registry (sites.mjs)`);
  return entry;
}

/**
 * The entry whose origin or alias is `origin`, or undefined.
 * @param {string} origin
 * @returns {SiteEntry | undefined}
 */
export function siteForOrigin(origin) {
  const bare = new URL(origin).origin;
  return SITES.find((s) => s.origin === bare || (s.aliases ?? []).includes(bare));
}

/**
 * The header overrides an entry declares (entryOverrides, ./headers), by id.
 * @param {string} id
 * @returns {Record<string, HeaderOverride>}
 */
export function siteOverrides(id) {
  return entryOverrides(siteEntry(id));
}
