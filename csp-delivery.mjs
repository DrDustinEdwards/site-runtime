/**
 * What goes around the policy csp.mjs builds: the Reporting-Endpoints header, the Report-Only companion for a rollout,
 * the Integrity-Policy header and the nonce renewed on an edge-cached page. ./csp re-exports what a caller imports.
 */

import { CSP_REPORT_GROUP, buildContentSecurityPolicy, generateNonce } from "./csp.mjs";
/** @typedef {import("./csp.mjs").SitePolicy} SitePolicy */

/**
 * The Reporting-Endpoints header value that defines a policy's `report-to` group: `csp-endpoint="https://example.com/csp-report"`.
 * The URL must be absolute and potentially trustworthy: https, or http on a loopback host (127.0.0.0/8, [::1], localhost or
 * a name under .localhost), so a local dev server works. A browser skips any other endpoint (Reporting API, "process
 * reporting endpoints": "If endpoint url's origin is not potentially trustworthy, then continue"; the hosts are Secure
 * Contexts, https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy), and the group's reports then go nowhere.
 *
 * @param {string} group the name the policy's `reportTo` gives
 * @param {string | URL} url the receiver, absolute: `new URL("/csp-report", origin)`
 * @returns {string}
 */
export function reportingEndpoints(group, url) {
  if (!/^[a-z*][a-z0-9_.*-]*$/.test(group))
    throw new Error(
      `${JSON.stringify(group)} is not a report-to group name (lower-case letters, digits, _ - . *)`,
    );
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `${JSON.stringify(String(url))} is not an absolute URL: Reporting-Endpoints ignores a relative endpoint`,
    );
  }
  // The URL parser lower-cases the host and writes an IPv4 address as four decimals, so these match every spelling.
  const local =
    parsed.protocol === "http:" &&
    /^(127(\.\d{1,3}){3}|\[::1\]|(.+\.)?localhost\.?)$/.test(parsed.hostname);
  if (parsed.protocol !== "https:" && !local)
    throw new Error(
      `${parsed.href} is not https or http on a loopback host: Reporting-Endpoints ignores an endpoint that is not potentially trustworthy`,
    );
  return `${group}="${parsed.href}"`;
}

/**
 * The Report-Only companion for a staged rollout: the site's own policy with `staged` added (Trusted Types first:
 * `{ trustedTypes: ["default"] }`), sent beside the enforced one, so the reports show what the stricter policy would
 * block before it blocks anything. When they show nothing, move `staged` into the enforced policy and drop this one.
 * @param {SitePolicy} site the options the enforced policy is built from
 * @param {Partial<SitePolicy>} staged what the next policy adds
 * @returns {{ name: "Content-Security-Policy-Report-Only", value: string }}
 */
export function buildStagedPolicy(site, staged) {
  if (Object.keys(staged).length === 0)
    throw new Error("a staged policy stages nothing: name what it adds");
  const { value } = buildContentSecurityPolicy({ ...site, ...staged, reportOnly: true });
  return { name: "Content-Security-Policy-Report-Only", value };
}

/**
 * The Integrity-Policy header: every script must carry integrity metadata (an `integrity` attribute), and a no-cors
 * script request is blocked (https://w3c.github.io/webappsec-subresource-integrity/#integrity-policy-section). It
 * needs build-time integrity on every bundle, dynamically imported chunks included (React Router's
 * `subResourceIntegrity: true` writes it into the import map and modulepreloads), so ship it Report-Only first.
 * `endpoint` is the Reporting-Endpoints group the reports go to (default CSP_REPORT_GROUP). buildSecurityHeaders
 * writes it from an entry's `integrityPolicy` opt-in.
 * @param {{ endpoint?: string, reportOnly?: boolean }} [options]
 * @returns {{ name: "Integrity-Policy" | "Integrity-Policy-Report-Only", value: string }}
 */
export function integrityPolicy({ endpoint = CSP_REPORT_GROUP, reportOnly = false } = {}) {
  if (!/^[a-z*][a-z0-9_.*-]*$/.test(endpoint))
    throw new Error(`${JSON.stringify(endpoint)} is not a Reporting-Endpoints group name`);
  return {
    name: reportOnly ? "Integrity-Policy-Report-Only" : "Integrity-Policy",
    value: `blocked-destinations=(script), endpoints=(${endpoint})`,
  };
}

const NONCE_SOURCE = /'nonce-([A-Za-z0-9+/_=-]+)'/;

/**
 * A stored page with a fresh nonce: the nonce its policy was rendered with becomes `nonce` in the Content-Security-Policy
 * (and Report-Only) header and in every `nonce="…"` attribute that held it, so no two readers of an edge-cached page share
 * one, and an element injected without the old nonce gains none. Call it on every response the cache answers, hit or
 * miss. A response that is not HTML, or whose policy has no nonce, comes back as it is. The attribute's value is swapped
 * in the byte stream, never by re-serializing the tag (HTMLRewriter writes `<link … />` where React wrote `<link …/>`), so
 * a stored page differs from a fresh render of the same page by its nonce alone. This is the third way to trust inline
 * scripts on a cached page, beside hashes, and the one to use before `inlineScripts`.
 * @param {Response} response
 * @param {string} [nonce] the new nonce (generateNonce), when the caller needs to know it
 * @returns {Response}
 */
export function renewNonce(response, nonce = generateNonce()) {
  const headers = new Headers(response.headers);
  const names = ["Content-Security-Policy", "Content-Security-Policy-Report-Only"];
  const rendered = names.map((n) => NONCE_SOURCE.exec(headers.get(n) ?? "")?.[1]).find(Boolean);
  if (!rendered || !/text\/html/i.test(headers.get("Content-Type") ?? "")) return response;
  for (const name of names) {
    const value = headers.get(name);
    if (value) headers.set(name, value.replaceAll(`'nonce-${rendered}'`, `'nonce-${nonce}'`));
  }
  const body =
    response.body && replaceInStream(response.body, `nonce="${rendered}"`, `nonce="${nonce}"`);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * `body` with every `from` made `to`, a match split across chunks included: each chunk holds back the tail that could
 * still begin a match.
 * @param {ReadableStream<Uint8Array>} body
 * @param {string} from
 * @param {string} to
 */
function replaceInStream(body, from, to) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let tail = "";
  /** @param {string} text @param {boolean} last */
  const swap = (text, last) => {
    let out = "";
    let i = 0;
    for (let at = text.indexOf(from); at !== -1; at = text.indexOf(from, i)) {
      out += text.slice(i, at) + to;
      i = at + from.length;
    }
    const keep = last ? text.length : Math.max(i, text.length - from.length + 1);
    tail = text.slice(keep);
    return out + text.slice(i, keep);
  };
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        const out = swap(tail + decoder.decode(chunk, { stream: true }), false);
        if (out) controller.enqueue(encoder.encode(out));
      },
      flush(controller) {
        const out = swap(tail + decoder.decode(), true);
        if (out) controller.enqueue(encoder.encode(out));
      },
    }),
  );
}
