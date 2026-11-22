/** @type {<E>(site: import("./worker.mjs").Site<E>, request: Request, env: E) => Promise<string | null>} */
export async function renderHtml(site, request, env) {
  const ctx = /** @type {ExecutionContext} */ (
    /** @type {unknown} */ ({ waitUntil() {}, passThroughOnException() {}, props: {} })
  );
  const response = await site.render(request, env, ctx);
  const html = (response.headers.get("Content-Type") ?? "").includes("text/html");
  return response.ok && html ? response.text() : null;
}
