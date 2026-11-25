/** The Content-Security-Policy half of the header check (C1 to C16, M1). */

import {
  CLOUDFLARE_WEB_ANALYTICS,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  broadSource,
} from "./csp.mjs";
import { allowlistBypass } from "./csp-bypasses.mjs";
import { parsePolicy } from "./check-core.mjs";
import { EMBED_FRAME_SOURCES } from "./embeds.mjs";

/** @import { CheckedSiteEntry } from "./check-core.mjs" */

/** The fetch directives, each graded for broad sources (C5). */
const FETCH_DIRECTIVES = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "object-src",
  "frame-src",
  "child-src",
  "worker-src",
  "manifest-src",
  "fenced-frame-src",
];

/**
 * Grades the policy and the headers that report it, recording through `result`.
 * @param {Headers} headers
 * @param {(id: string, name: string, pass: boolean, detail: string, warn?: boolean, declinable?: string | boolean) => void} result
 * @param {CheckedSiteEntry | undefined} entry
 * @param {Record<string, any>} o the check's options, with the registry's opt-ins applied
 */
export function checkPolicy(headers, result, entry, o) {
  const {
    inlineScripts,
    inlineStyles,
    strictDynamic,
    trustedTypes,
    denyUnlisted,
    cloudflareWebAnalytics,
    framedBySameOrigin,
    baseUriSelf,
    formTargets,
    embeds,
  } = o;

  const enforced = headers.get("Content-Security-Policy");
  const reportOnly = headers.get("Content-Security-Policy-Report-Only");
  result(
    "C1",
    "the Content-Security-Policy is enforced, not only reported",
    Boolean(enforced),
    enforced
      ? ""
      : reportOnly
        ? "only a Report-Only policy is sent, which blocks nothing"
        : "ABSENT",
  );
  if (!enforced) return;

  // Headers joins a repeated header with ", ", and no source holds a comma, so a comma means two policies, which a
  // browser enforces together (the stricter wins on every directive).
  result(
    "C13",
    "one enforced policy, sent once",
    !enforced.includes(","),
    "two policies were sent (they arrive joined by a comma); send one",
  );
  const names = enforced
    .split(";")
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase() ?? "")
    .filter(Boolean);
  const repeated = names.filter((n, i) => names.indexOf(n) !== i);
  result(
    "C13",
    "no directive is written twice",
    repeated.length === 0,
    `${[...new Set(repeated)].join(", ")} repeated: a browser applies the first and ignores the rest`,
  );
  const policy = parsePolicy(enforced);
  const scripts = policy.get("script-src") ?? policy.get("default-src");
  result(
    "C4",
    "the policy governs scripts (script-src or default-src)",
    Boolean(scripts),
    "neither directive is present, so any script runs",
  );
  // script-src-elem, script-src-attr and worker-src override script-src, so each one present is held to the same rules.
  const scriptDirectives = /** @type {Array<[string, string[]]>} */ ([
    ["scripts", scripts ?? []],
    ...["script-src-elem", "script-src-attr", "worker-src"].flatMap((d) =>
      policy.has(d) ? [[d, policy.get(d) ?? []]] : [],
    ),
  ]);
  for (const [label, sources] of scripts ? scriptDirectives : scriptDirectives.slice(1)) {
    const keywords = sources.map((s) => s.toLowerCase());
    const noun = label === "scripts" ? "script" : label;
    const inlineDeclared = label === "scripts" && inlineScripts === "unsafe-inline";
    result(
      "C4",
      `${label}: no 'unsafe-inline'${inlineDeclared ? " (declared: inlineScripts)" : ""}`,
      inlineDeclared || !keywords.includes("'unsafe-inline'"),
      `${noun} sources: ${sources.join(" ")}`,
    );
    result(
      "C4",
      `${label}: no 'unsafe-eval'`,
      !keywords.includes("'unsafe-eval'"),
      `${noun} sources: ${sources.join(" ")}`,
    );
    // A JSONP or AngularJS host runs script only where scripts or workers load, so only these are held to it.
    const bypasses = sources.flatMap((s) => {
      const bypass = allowlistBypass(s);
      return bypass ? [`${s} (${bypass})`] : [];
    });
    result(
      "C5",
      `${label}: no host known to serve JSONP, AngularJS or Flash (csp-evaluator)`,
      bypasses.length === 0,
      `allows ${bypasses.join(", ")}`,
    );
  }
  for (const directive of FETCH_DIRECTIVES) {
    const sources = policy.get(directive);
    if (!sources) continue;
    const rule =
      directive === "default-src" && !policy.has("script-src") ? "script-src" : directive;
    const broad = sources.flatMap((s) => {
      const why = broadSource(s, rule);
      return why ? [`${s} (${why})`] : [];
    });
    result(
      "C5",
      `${directive}: no wildcard or bare scheme source`,
      broad.length === 0,
      `allows ${broad.join(", ")}`,
    );
  }
  // 'unsafe-inline' beside a nonce or hash is ignored by browsers, so only an effective one counts. Style attributes
  // (style-src-attr) run no code.
  for (const directive of ["style-src", "style-src-elem"]) {
    const sources = (
      policy.get(directive) ??
      (directive === "style-src" ? policy.get("default-src") : undefined) ??
      []
    ).map((s) => s.toLowerCase());
    if (
      !sources.includes("'unsafe-inline'") ||
      sources.some((s) => /^'(nonce|sha(256|384|512))-/.test(s))
    )
      continue;
    result(
      "C11",
      `${directive}: no 'unsafe-inline'${inlineStyles ? " (declared: inlineStyles)" : ""}`,
      inlineStyles,
      `style sources: ${sources.join(" ")}`,
    );
  }
  // C3: a strict script policy, 'strict-dynamic' beside a nonce or hash, or no script at all ('none').
  const scriptList = scripts ?? [];
  const noScript = scriptList.length === 1 && scriptList[0] === "'none'";
  if (strictDynamic || entry)
    result(
      "C3",
      `script-src is strict: 'strict-dynamic' beside a nonce or hash, or 'none'${strictDynamic ? " (declared: strictDynamic)" : ""}`,
      noScript ||
        (scriptList.includes("'strict-dynamic'") &&
          scriptList.some((s) => /^'(nonce|sha(256|384|512))-/.test(s))),
      `script sources: ${scriptList.join(" ")}`,
      false,
      !strictDynamic,
    );
  const staged = parsePolicy(reportOnly ?? "");
  const stagedLabel = (/** @type {unknown} */ declaredAs) =>
    declaredAs === "report-only" ? "the Report-Only policy" : "the policy";
  const fallback = (denyUnlisted === "report-only" ? staged : policy).get("default-src");
  if (denyUnlisted || entry)
    result(
      "C9",
      `${stagedLabel(denyUnlisted)}: default-src is 'none'${denyUnlisted ? " (declared: denyUnlisted)" : ""}`,
      fallback?.length === 1 && fallback[0] === "'none'",
      `got ${fallback ? fallback.join(" ") : "ABSENT"}`,
      false,
      !denyUnlisted,
    );
  const types = (trustedTypes === "report-only" ? staged : policy).get("require-trusted-types-for");
  if (trustedTypes || entry)
    result(
      "C7",
      `${stagedLabel(trustedTypes)} requires Trusted Types for scripts${trustedTypes ? " (declared: trustedTypes)" : ""}`,
      (types ?? []).includes("'script'"),
      `require-trusted-types-for is ${types?.join(" ") ?? "ABSENT"}`,
      false,
      !trustedTypes,
    );
  // A site that embeds post players (./embeds) lets every one of them into its frames, or a reader's click loads nothing.
  if (embeds) {
    const frames = (
      policy.get("frame-src") ??
      policy.get("child-src") ??
      policy.get("default-src") ??
      []
    ).map((s) => s.toLowerCase());
    const shut = EMBED_FRAME_SOURCES.filter((o) => !frames.includes(o));
    result(
      "C16",
      "frame-src lets in every post player (declared: embeds)",
      shut.length === 0,
      `refuses ${shut.join(" ")} (EMBED_FRAME_SOURCES, ./embeds)`,
    );
  }
  const objects = policy.get("object-src") ?? policy.get("default-src");
  result(
    "C2",
    "object-src is 'none'",
    objects?.length === 1 && objects[0] === "'none'",
    `got ${objects ? objects.join(" ") : "ABSENT"}`,
  );
  // A declared opt-in allows 'self' (a site may use it on some pages only); a site entry that does not declare it allows 'none' alone.
  const one = (/** @type {boolean | undefined} */ self) =>
    self === false ? ["'none'"] : ["'none'", "'self'"];
  const base = policy.get("base-uri");
  const bases = one(baseUriSelf);
  result(
    "C2",
    `base-uri is ${bases.join(" or ")}`,
    base?.length === 1 && bases.includes(base[0] ?? ""),
    `got ${base ? base.join(" ") : "ABSENT (it does not fall back to default-src)"}`,
  );
  const ancestors = policy.get("frame-ancestors");
  const framers = one(framedBySameOrigin);
  result(
    "H3",
    `frame-ancestors is ${framers.join(" or ")}`,
    ancestors?.length === 1 && framers.includes(ancestors[0] ?? ""),
    `got ${ancestors ? ancestors.join(" ") : "ABSENT (it does not fall back to default-src)"}`,
  );
  // form-action may be absent: an OAuth consent page leaves it out (browsers apply it to every redirect hop, the last
  // being the client's redirect_uri). Present, it must keep forms on this origin beside the declared formTargets.
  const forms = policy.get("form-action");
  const declaredForms = formTargets.length > 0;
  result(
    "C8",
    `form-action, when set, is 'self' or 'none'${declaredForms ? " (and the declared formTargets)" : ""}`,
    !forms ||
      (forms.length === 1 && (forms[0] === "'self'" || forms[0] === "'none'")) ||
      (forms[0] === "'self'" &&
        forms.length > 1 &&
        forms.slice(1).every((target) => formTargets.includes(target))),
    `got ${forms ? forms.join(" ") : "ABSENT"}`,
  );
  if (cloudflareWebAnalytics === "manual") {
    const { script, connect: reports } = CLOUDFLARE_WEB_ANALYTICS.manual;
    const missingScript = script.filter((source) => !(scripts ?? []).includes(source));
    const connect = policy.get("connect-src") ?? policy.get("default-src") ?? [];
    const missingConnect = reports.filter((source) => !connect.includes(source));
    result(
      "C15",
      "the policy lets the manual Cloudflare Web Analytics beacon run: its script file",
      missingScript.length === 0,
      `script-src lacks ${missingScript.join(" and ")}`,
    );
    result(
      "C15",
      "the policy lets the manual beacon report: connect-src includes cloudflareinsights.com",
      missingConnect.length === 0,
      `connect-src is ${connect.join(" ") || "ABSENT"}, lacking ${missingConnect.join(" and ")}`,
    );
  } else if (cloudflareWebAnalytics) {
    const missingScript = CLOUDFLARE_WEB_ANALYTICS.script.filter(
      (source) => !(scripts ?? []).includes(source),
    );
    const connect = policy.get("connect-src") ?? policy.get("default-src") ?? [];
    result(
      "C15",
      "the policy lets the Cloudflare Web Analytics beacon run: its script path prefix",
      missingScript.length === 0,
      `script-src lacks ${missingScript.join(" and ")}: the edge injects /beacon.min.js/v..., which the bare file URL does not match`,
    );
    result(
      "C15",
      "the policy lets the beacon report: connect-src includes the site itself",
      connect.includes("'self'"),
      `connect-src is ${connect.join(" ") || "ABSENT"}`,
    );
  }
  const sinks = ["report-uri", "report-to"].filter((d) => !policy.has(d));
  result(
    "C14",
    "violations are reported to both sinks (report-uri and report-to)",
    sinks.length === 0,
    `no ${sinks.join(" and ")}: ${sinks.length === 2 ? "a blocked script is never heard about" : "the browsers that read only the other one report nowhere"}`,
  );
  const reportUri = policy.get("report-uri")?.[0];
  const group = policy.get("report-to")?.[0];
  if (entry && reportUri) {
    const path = URL.parse(reportUri, "https://site.invalid")?.pathname;
    result(
      "C14",
      `report-uri is the family's ${CSP_REPORT_PATH}`,
      path === CSP_REPORT_PATH,
      `got ${reportUri} (CSP_REPORT_PATH, ./csp)`,
    );
  }
  if (entry && group)
    result(
      "C14",
      `report-to names the family's group ${CSP_REPORT_GROUP}`,
      group === CSP_REPORT_GROUP,
      `got ${group} (CSP_REPORT_GROUP, ./csp)`,
    );
  // Every group a header reports to must be one Reporting-Endpoints defines, or its reports go nowhere.
  const endpoints = headers.get("Reporting-Endpoints") ?? "";
  const groups = new Set([
    ...(group ? [group] : []),
    ...["Cross-Origin-Embedder-Policy", "Cross-Origin-Embedder-Policy-Report-Only"].flatMap(
      (n) => /report-to="([^"]+)"/.exec(headers.get(n) ?? "")?.[1] ?? [],
    ),
    ...["Integrity-Policy", "Integrity-Policy-Report-Only"].flatMap(
      (n) =>
        /endpoints=\(([^)]*)\)/
          .exec(headers.get(n) ?? "")?.[1]
          ?.trim()
          .split(/\s+/)
          .filter(Boolean) ?? [],
    ),
  ]);
  for (const name of groups) {
    const url =
      new RegExp(
        `(?:^|,)\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*"([^"]*)"`,
      ).exec(endpoints)?.[1] ?? "";
    result(
      "M1",
      `Reporting-Endpoints names the report group ${name} with an https URL`,
      /^https:\/\//i.test(url) ||
        /^http:\/\/(127(\.\d{1,3}){3}|\[::1\]|(.+\.)?localhost)(:\d+)?\//i.test(url),
      endpoints
        ? `got ${JSON.stringify(endpoints)}`
        : "Reporting-Endpoints is ABSENT, so its reports go nowhere",
    );
  }
}
