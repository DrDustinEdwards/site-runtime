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
 *   trustedTypes (C7, `true` enforced or "report-only"), denyUnlisted (C9), integrityPolicy (S2, "enforce" or
 *   "report-only"), coep (I3, which buildSecurityHeaders writes) and uploads (A3, the path prefix its uploaded files
 *   are served under, which the live check samples).
 * - `deviations`: a checklist item the site does not meet, by item id, with the reason; the check then reports it as a
 *   warning, not an error. Only an item a check marks as one a site may decline takes one (K1's cookie prefix, A6),
 *   and `value` names the cookies a K1 deviation covers. FAMILY_DEVIATIONS holds the items no site can meet.
 * - `aliases`: other origins the same Worker answers for, such as the domain it will move to.
 */

import { PASSKEY_OVERRIDES, entryOverrides, permissionsAllowingSelf } from "./headers.mjs";

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
 *   denyUnlisted?: { value: boolean, reason: string },
 *   integrityPolicy?: { value: "enforce" | "report-only", reason: string },
 *   coep?: { value: "credentialless" | "require-corp", reportOnly?: boolean, reason: string },
 *   uploads?: { value: string, reason: string },
 * }} SiteOptIns
 * @typedef {{ reason: string, value?: readonly string[] }} Deviation
 * @typedef {{ id: string, origin: string, aliases?: readonly string[], headers?: Readonly<Record<string, HeaderOverride>>, optIns?: SiteOptIns, deviations?: Readonly<Record<string, Deviation>> }} SiteEntry
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

// What no site that ships bundles or the beacon can meet yet, and why COEP waits where it does (area 2, 2026-10-31).
const noIntegrity = {
  reason: "Integrity-Policy refuses every script without an integrity attribute: Vite and React Router emit none for entry chunks, modulepreloads or dynamic imports, and the edge injects the Web Analytics beacon without one. Report-Only would teach nothing: receiveCspReport keeps csp-violation reports only.",
};
const noIntegrityBundles = {
  reason: "Integrity-Policy refuses every script without an integrity attribute, and Vite emits none for entry chunks, modulepreloads or dynamic imports. Report-Only would teach nothing: receiveCspReport keeps csp-violation reports only.",
};
const signedInUnlisted = (/** @type {string} */ pages) => ({
  reason: `default-src 'none' refuses whatever a page loads that the policy does not name, and ${pages} sit behind a sign-in no session-less crawl reaches, so the change waits for a crawl with a session.`,
});
const signedInCoep = (/** @type {string} */ pages) => ({
  reason: `COEP changes how every cross-origin load and frame is fetched, and it cannot be staged: buildSecurityHeaders writes no report-to and the family sink keeps CSP reports only. ${pages} sit behind a sign-in no session-less crawl reaches, so the change waits for a crawl with a session.`,
});
const coepCredentialless = {
  value: /** @type {const} */ ("credentialless"),
  reason: "The pages embed no frame and load nothing from another origin that needs a cookie (the beacon included).",
};

/* Each entry is its own export, so a Worker that imports one (`import { germomics } from "./sites"`) bundles that
 * entry alone; the calls are marked pure so a bundler can drop the rest. */

// workers/security-headers.mjs, workers/csp.mjs
export const dustinedwardsInfo = {
  id: "dustinedwards-info",
  origin: "https://dustinedwards.info",
  headers: {
    "Referrer-Policy": { value: STRICT_ORIGIN, reason: "The ratified value for this site; OSHP's no-referrer has not been ruled on for it." },
    "Permissions-Policy": {
      value: /* @__PURE__ */ permissionsAllowingSelf("clipboard-write", "screen-wake-lock"),
      reason: "clipboard-write must stay allowed: the copy controls swallow the refusal silently. The procedure run view keeps the screen awake (navigator.wakeLock, app/enhance/run.ts).",
    },
    "Cross-Origin-Opener-Policy": {
      value: "same-origin-allow-popups",
      reason: "Plain same-origin would sever the opener of any cross-origin popup a sign-in or embed opens; allow-popups keeps that working and is the ratified value.",
    },
  },
  optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/csp.mjs") },
  deviations: {
    C9: /* @__PURE__ */ signedInUnlisted("the admin, lab and procedure pages"),
    S2: noIntegrity,
    I3: { reason: "Cross-origin isolation needs COOP same-origin, and this site's ratified COOP is same-origin-allow-popups, so COEP would isolate nothing." },
  },
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
  },
  deviations: {
    C9: /* @__PURE__ */ signedInUnlisted("the merchant app and admin"),
    S2: noIntegrity,
    I3: /* @__PURE__ */ signedInCoep("The merchant app, Stripe's returns and the admin"),
  },
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
  },
  deviations: {
    C9: /* @__PURE__ */ signedInUnlisted("the reader, journal and settings"),
    S2: noIntegrity,
    I3: /* @__PURE__ */ signedInCoep("The reader's book frames, the journal and settings"),
  },
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
  },
  deviations: {
    C9: /* @__PURE__ */ signedInUnlisted("the admin and its editor"),
    S2: noIntegrity,
    I3: { reason: "The data pages load Google Maps' script, tiles and fonts and the games load Phaser's assets, none of which this site controls; COEP cannot be staged (buildSecurityHeaders writes no report-to and the family sink keeps CSP reports only), so it waits for the Capsomer move's own design job." },
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
  },
  deviations: { S2: noIntegrity },
};

// workers/security-headers.ts
export const bsw = {
  id: "bsw",
  origin: "https://bsw.dustin-edwards.workers.dev",
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/security-headers.ts"),
    denyUnlisted: { value: true, reason: "Marketing pages that load their own files, data: images and the beacon; the manifest is named." },
    coep: coepCredentialless,
  },
  deviations: { S2: noIntegrity },
};

// app/lib/security-headers.ts; SITE_ORIGIN is txasm.org (app/lib/site-meta.ts), served from workers.dev until cutover.
export const txasm = {
  id: "txasm",
  origin: "https://txasm.dustin-edwards.workers.dev",
  aliases: ["https://txasm.org"],
  headers: { "Referrer-Policy": signInReferrer },
  optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("app/lib/security-headers.ts"), passkey },
  deviations: {
    A6: { reason: "txasm.dustin-edwards.workers.dev is the live site until the txasm.org cutover; noindex there would take the meeting site out of search." },
    C9: /* @__PURE__ */ signedInUnlisted("submission, review, the abstract book's PDF.js viewer and the admin"),
    S2: noIntegrity,
    I3: /* @__PURE__ */ signedInCoep("Submission, review, the PDF.js viewer and the admin"),
  },
};

const nothingUnlisted = { value: true, reason: "A static site that loads nothing beyond what its policy names: default-src 'none'." };

export const carrel = {
  id: "carrel",
  origin: "https://carrel.dustinedwards.info",
  optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("www/headers.mjs"), denyUnlisted: nothingUnlisted, coep: coepCredentialless },
  deviations: { S2: noIntegrity },
};

// workers/security-headers.ts: the standard exactly, behind Access; the beacon is never injected.
export const carrelDesk = {
  id: "carrel-desk",
  origin: "https://desk.dustinedwards.info",
  optIns: { strictDynamic: { value: true, reason: "The nonced entry scripts load the route chunks (workers/security-headers.ts appPolicy)." } },
  deviations: {
    C9: /* @__PURE__ */ signedInUnlisted("all of Desk's pages"),
    S2: noIntegrityBundles,
    I3: { reason: "The editor frames each draft's preview, the site's own markup served under a sandbox policy; COEP on Desk would refuse every preview that does not carry it too, and it cannot be staged (buildSecurityHeaders writes no report-to)." },
  },
};

// src/security-headers.ts, src/dashboard-csp.ts
export const capsidPortal = {
  id: "capsid-portal",
  origin: "https://portal.dustinedwards.info",
  optIns: { denyUnlisted: { value: true, reason: "The dashboard loads only its own scripts, styles and data: images (src/dashboard-csp.ts)." } },
  deviations: { S2: noIntegrityBundles, I3: /* @__PURE__ */ signedInCoep("Every Portal page") },
};

// src/security-headers.ts: its only page is the /authorize consent dialog MCP clients open.
export const capsidMcp = { id: "capsid-mcp", origin: "https://mcp.dustinedwards.info", headers: popupSignIn };

// workers/security-headers.ts: Carrel's AI door.
export const carrelMcp = { id: "carrel-mcp", origin: "https://carrel-mcp.dustinedwards.info", headers: popupSignIn };

// The Capsid explorer declares nothing: the standard exactly.
export const capsid = { id: "capsid", origin: "https://capsid.dustinedwards.info" };

// scripts/security-headers.ts
export const enarratio = {
  id: "enarratio",
  origin: "https://enarratio.dustinedwards.info",
  optIns: {
    denyUnlisted: { value: true, reason: "The gallery loads its own files, data: images and the beacon, and reports to cloudflareinsights.com." },
    coep: coepCredentialless,
  },
  deviations: { S2: noIntegrity },
};

// mcp/src/door.ts: Foxhound's admin AI door.
export const foxhoundMcp = { id: "foxhound-mcp", origin: "https://admin-mcp.foxhoundapp.com", headers: popupSignIn };

// dustinedwards-info mcp/src/security-headers.ts: the site's admin MCP.
export const dustinedwardsMcp = { id: "dustinedwards-mcp", origin: "https://admin-mcp.dustinedwards.info", headers: popupSignIn };

// foxing mcp/src/index.ts: Foxing's admin MCP, the standard exactly.
export const foxingMcp = { id: "foxing-mcp", origin: "https://admin-mcp.foxing.app" };

// scripts/security-headers.ts
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
  },
};

export const prelum = {
  id: "prelum",
  origin: "https://prelum.dustinedwards.info",
  optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("specimen/headers.mjs"), denyUnlisted: nothingUnlisted },
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
