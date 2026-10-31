/**
 * The site registry: one entry per live site, holding only where it departs from the bar and why. The header builder
 * (`buildSecurityHeaders({ site })`), the check (`checkSecurityHeaders(headers, { site })`) and the live check
 * (bin/site-runtime-security.mjs) all read it, so a site cannot build one set and be graded against another.
 *
 * An entry is filled from the site's own code (the file is named beside it), with the reason that code gives. A
 * deviation an audit marked as a gap is left out on purpose, so the check keeps failing it until the site is fixed:
 * dustinedwards.info's nine-feature Permissions-Policy and one-year HSTS, germomics' Permissions-Policy allowances
 * and wildcard script hosts, and `Cross-Origin-Resource-Policy: cross-origin` on every response (a site marks shared
 * media with corpFor, ./headers, instead).
 *
 * - `headers`: overrides in buildSecurityHeaders' shape, `{ value, reason }`, `value: null` to send none.
 * - `optIns`: the builder options a check must accept, each `{ value, reason }`: cloudflareWebAnalytics (the edge
 *   injects the beacon, so the policy must let it run), inlineScripts, formTargets, framedBySameOrigin, baseUriSelf,
 *   and passkey (publickey-credentials-get=(self) in the Permissions-Policy, PASSKEY_OVERRIDES).
 * - `aliases`: other origins the same Worker answers for, such as the domain it will move to.
 */

import { PASSKEY_OVERRIDES, entryOverrides, permissionsAllowingSelf } from "./headers.mjs";

export { PASSKEY_OVERRIDES, permissionsAllowingSelf };

const beacon = (/** @type {string} */ where) => ({ value: true, reason: `Cloudflare Web Analytics is on; the edge injects the beacon (${where}).` });
const passkey = { value: true, reason: "The family sign-in offers a passkey (./sign-in)." };
const STRICT_ORIGIN = "strict-origin-when-cross-origin";
const capsidCoop = {
  "Cross-Origin-Opener-Policy": { value: null, reason: "COOP is on trial as Report-Only (COOP_REPORT_ONLY) pending a demonstrated case and a ruling (capsid src/security-headers.ts)." },
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
 * }} SiteOptIns
 * @typedef {{ id: string, origin: string, aliases?: readonly string[], headers?: Readonly<Record<string, HeaderOverride>>, optIns?: SiteOptIns }} SiteEntry
 */

/* Each entry is its own export, so a Worker that imports one (`import { germomics } from "./sites"`) bundles that
 * entry alone; the calls are marked pure so a bundler can drop the rest. */

// workers/security-headers.mjs, workers/csp.mjs
export const dustinedwardsInfo = {
  id: "dustinedwards-info",
  origin: "https://dustinedwards.info",
  headers: {
    "Referrer-Policy": { value: STRICT_ORIGIN, reason: "The ratified value for this site; OSHP's no-referrer has not been ruled on for it." },
    "Permissions-Policy": { value: /* @__PURE__ */ permissionsAllowingSelf("clipboard-write"), reason: "clipboard-write must stay allowed: the copy controls swallow the refusal silently." },
    "Cross-Origin-Opener-Policy": {
      value: "same-origin-allow-popups",
      reason: "Plain same-origin would sever the opener of any cross-origin popup a sign-in or embed opens; allow-popups keeps that working and is the ratified value.",
    },
  },
  optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/csp.mjs") },
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
};

// apps/web/workers/security-headers.ts
export const foxing = {
  id: "foxing",
  origin: "https://foxing.app",
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/security-headers.ts"),
    baseUriSelf: { value: true, reason: "The reader (/read/:slug): Readium writes a same-origin <base> so a book's images and CSS resolve." },
    passkey,
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
  },
  optIns: {
    cloudflareWebAnalytics: /* @__PURE__ */ beacon("app/lib/security-headers.ts"),
    inlineScripts: { value: "unsafe-inline", reason: "React Router streams inline hydration scripts and the pre-paint theme script is inline on edge-cached pages." },
  },
};

export const julieedwardsInfo = { id: "julieedwards-info", origin: "https://julieedwards.info", optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/security-headers.ts") } };

export const bsw = { id: "bsw", origin: "https://bsw.dustin-edwards.workers.dev", optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("workers/security-headers.ts") } };

// app/lib/security-headers.ts; SITE_ORIGIN is txasm.org (app/lib/site-meta.ts), served from workers.dev until cutover.
export const txasm = {
  id: "txasm",
  origin: "https://txasm.dustin-edwards.workers.dev",
  aliases: ["https://txasm.org"],
  optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("app/lib/security-headers.ts"), passkey },
};

export const carrel = { id: "carrel", origin: "https://carrel.dustinedwards.info", optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("www/headers.mjs") } };

// workers/security-headers.ts: the standard exactly, behind Access; the beacon is never injected.
export const carrelDesk = { id: "carrel-desk", origin: "https://desk.dustinedwards.info" };

// src/security-headers.ts, src/dashboard-csp.ts
export const capsidPortal = { id: "capsid-portal", origin: "https://portal.dustinedwards.info", headers: capsidCoop };

export const capsidMcp = { id: "capsid-mcp", origin: "https://mcp.dustinedwards.info", headers: capsidCoop };

// The Capsid explorer, Enarratio's site and the Foxhound admin MCP declare nothing: the standard exactly.
export const capsid = { id: "capsid", origin: "https://capsid.dustinedwards.info" };

export const enarratio = { id: "enarratio", origin: "https://enarratio.dustinedwards.info" };

export const foxhoundMcp = { id: "foxhound-mcp", origin: "https://admin-mcp.foxhoundapp.com" };

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

export const prelum = { id: "prelum", origin: "https://prelum.dustinedwards.info", optIns: { cloudflareWebAnalytics: /* @__PURE__ */ beacon("specimen/headers.mjs") } };

/** @type {readonly SiteEntry[]} */
export const SITES = /* @__PURE__ */ Object.freeze([
  dustinedwardsInfo, foxhound, foxing, germomics, julieedwardsInfo, bsw, txasm, carrel, carrelDesk, capsidPortal, capsidMcp, capsid, enarratio, foxhoundMcp, capsomer, prelum,
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
