/** With the test grant: tools/list judged (T1 to T12), the capabilities it declares and the rate-limit burst (S1). */

import { MCP_PER_MINUTE, toolListHash, toolListProblems } from "../mcp-server.mjs";
import { MCP_HEADERS, envelope, rpcOf } from "./ai-audit-wire.mjs";

/** @import { Ctx } from "./ai-audit-wire.mjs" */

/** Every page of tools/list as the grant sees it, or the reason there is none. */
async function listTools(
  /** @type {Ctx} */ { get },
  /** @type {string} */ endpoint,
  /** @type {string} */ grant,
) {
  /** @type {Record<string, any>[]} */
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const r = await get(endpoint, {
      method: "POST",
      headers: { ...MCP_HEADERS, "mcp-method": "tools/list", authorization: `Bearer ${grant}` },
      body: envelope("tools/list", cursor ? { cursor } : {}),
    });
    if (!r.res) return { url: r.url, tools: null, why: r.why };
    const rpc = r.res.ok ? await rpcOf(r.res) : (await r.res.body?.cancel().catch(() => {}), null);
    if (!Array.isArray(rpc?.result?.tools)) {
      return {
        url: r.url,
        tools: null,
        why: r.res.ok
          ? `tools/list answered no tools${rpc?.error ? ` (${rpc.error.code})` : ""}`
          : `the test grant was answered ${r.res.status}`,
      };
    }
    tools.push(...rpc.result.tools);
    cursor =
      typeof rpc.result.nextCursor === "string" && rpc.result.nextCursor
        ? rpc.result.nextCursor
        : undefined;
    if (!cursor) return { url: r.url, tools, why: "" };
  }
  return { url: endpoint, tools: null, why: "tools/list still had a next page after 20" };
}

/** The capabilities the server declares in server/discover to the grant, or null when it does not say. */
export async function declaredCapabilities(
  /** @type {Ctx} */ { get },
  /** @type {string} */ endpoint,
  /** @type {string} */ grant,
) {
  const r = await get(endpoint, {
    method: "POST",
    headers: { ...MCP_HEADERS, authorization: `Bearer ${grant}` },
    body: envelope("server/discover"),
  });
  if (!r.res?.ok) return (await r.res?.body?.cancel().catch(() => {}), null);
  const capabilities = (await rpcOf(r.res))?.result?.capabilities;
  return capabilities && typeof capabilities === "object" ? capabilities : null;
}

export async function auditTools(
  /** @type {Ctx} */ ctx,
  /** @type {string} */ endpoint,
  /** @type {string} */ grant,
  /** @type {string | undefined} */ toolsHash,
) {
  const { report } = ctx;
  const first = await listTools(ctx, endpoint, grant);
  if (!first.tools) return report("error", "T1", first.url, first.why);
  for (const p of toolListProblems(first.tools))
    report(p.severity, p.item, first.url, `${p.tool}: ${p.detail}`);

  const second = await listTools(ctx, endpoint, grant);
  const names = (/** @type {Record<string, any>[] | null} */ list) =>
    (list ?? []).map((t) => String(t.name)).join(",");
  if (names(second.tools) !== names(first.tools))
    report(
      "error",
      "T7",
      first.url,
      "two tools/list calls in a row listed different tools or a different order",
    );
  const writes = first.tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
  if (writes.length)
    report(
      "error",
      "T7",
      first.url,
      `the read-only test grant lists tools that are not read-only: ${writes.slice(0, 10).join(", ")}`,
    );

  const hash = await toolListHash(first.tools);
  const pinned = toolsHash?.trim().toLowerCase();
  if (!pinned)
    report(
      "warning",
      "T12",
      first.url,
      `no --tools-hash pinned; the test grant's list hashes to ${hash}`,
    );
  else if (pinned !== hash)
    report(
      "error",
      "T12",
      first.url,
      `the tool list changed: it hashes to ${hash}, not the pinned ${pinned}; review the change, then pin the new hash`,
    );
}

/** S1: a concurrent burst over the limit, as the test grant, gets at least one 429. */
export async function burst(
  /** @type {Ctx} */ { get, report },
  /** @type {string} */ endpoint,
  /** @type {string} */ grant,
) {
  const count = MCP_PER_MINUTE + 5;
  const answers = await Promise.all(
    Array.from({ length: count }, () =>
      get(endpoint, {
        method: "POST",
        headers: { ...MCP_HEADERS, "mcp-method": "tools/list", authorization: `Bearer ${grant}` },
        body: envelope("tools/list"),
      }),
    ),
  );
  const statuses = answers.map((a) => a.res?.status ?? 0);
  await Promise.allSettled(answers.map(async (a) => a.res?.body?.cancel()));
  const limited = answers.filter((a) => a.res?.status === 429);
  if (limited.length === 0)
    report(
      "error",
      "S1",
      endpoint,
      `${count} concurrent requests by one caller, none refused (statuses ${[...new Set(statuses)].join(", ")})`,
    );
  else if (!limited.every((a) => a.res?.headers.has("retry-after")))
    report("warning", "S1", endpoint, "a 429 without Retry-After");
}
