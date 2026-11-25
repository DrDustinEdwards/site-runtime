/** The device and place a request names, a leaf shared by the sign-in modules. */

// First match wins: Edge, Opera and Samsung Internet also say Chrome, Chrome on iOS says Safari, and every browser on an
// iPhone says "like Mac OS X", so the specific names come first.
/** @type {[RegExp, string][]} */
const BROWSERS = [
  [/\b(?:Edg|EdgA|EdgiOS)\//, "Edge"],
  [/\b(?:OPR|OPiOS)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];
/** @type {[RegExp, string][]} */
const SYSTEMS = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

/**
 * The browser and system a user agent names ("Safari on iPhone", "Chrome on Windows"), one of them
 * alone when only one is known, or null. An iPad that asks for the desktop site says Macintosh, so it reads as a Mac.
 * @param {string | null | undefined} userAgent
 * @returns {string | null}
 */
export function deviceName(userAgent) {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? null;
}

/**
 * The city, region and country Cloudflare placed a request in (`request.cf`), as words ("Portland, Oregon, United States"),
 * or null outside Workers and for a request built by the site.
 * @param {Request & { cf?: { city?: unknown, region?: unknown, country?: unknown } } | null | undefined} request
 * @returns {string | null}
 */
export function coarseLocation(request) {
  const cf = request?.cf;
  if (!cf) return null;
  const country = typeof cf.country === "string" && cf.country ? countryName(cf.country) : null;
  const parts = [cf.city, cf.region, country].filter(
    (part) => typeof part === "string" && part !== "",
  );
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

/** @param {string} code */
function countryName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code; // Cloudflare's own codes (T1 for Tor, XX for unknown) are not regions
  }
}
