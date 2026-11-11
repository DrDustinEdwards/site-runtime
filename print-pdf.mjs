/**
 * HTML to PDF with Browser Rendering, the two ways the sites need it. From txasm's abstract book
 * (app/lib/book-pdf.server.ts, app/lib/paged.ts) and dustinedwards.info's CV (app/lib/cv/pdf.server.ts).
 *
 * - quickPdf: the REST quick action (`BROWSER.quickAction("pdf", ...)`), for a page that is ready on load (the CV).
 * - pagedPdf: a full browser through @cloudflare/puppeteer, which the site passes in as its own dependency (as
 *   workers-og is passed to ./share-card), for a page laid out by Paged.js after load (the book): it waits for the
 *   fonts and Paged.js's completion mark before printing.
 * Either one checks that what came back is a PDF, so a 200 that is not one never replaces one that is.
 */

/** The attribute Paged.js's `after` hook sets on <html> when it has laid out every page. */
export const PAGED_DONE_ATTRIBUTE = "data-pagedjs-done";

/**
 * The config script a Paged.js page runs before the polyfill: auto layout, then the completion mark the render waits
 * on. Its text is fixed so a page's CSP can trust it by hash.
 */
export const PAGED_JS_CONFIG = `
  window.PagedConfig = {
    auto: true,
    after: () => {
      document.documentElement.setAttribute("${PAGED_DONE_ATTRIBUTE}", "true");
    },
  };
`;

/**
 * The closing scripts of a Paged.js page: the config, then the self-hosted polyfill with its integrity hash (a page
 * previewed with a signed-in session must not run a changed file).
 * @param {{ path: string, integrity: string }} polyfill
 */
export function pagedScripts({ path, integrity }) {
  return `<script>${PAGED_JS_CONFIG}</script>
<script src="${path}" integrity="${integrity}" crossorigin="anonymous"></script>`;
}

/**
 * Throws unless `bytes` is a PDF (at least 1 KiB and starting %PDF-).
 * @param {Uint8Array} bytes
 * @param {string} what names the document in the error
 */
function assertPdf(bytes, what) {
  if (bytes.length < 1024 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-")
    throw new Error(
      `Browser Rendering answered with ${bytes.length} bytes for ${what} that are not a PDF.`,
    );
}

/**
 * A PDF through the quick action. Throws, naming what failed: no binding, a refusal, or bytes that are not a PDF.
 * @param {{ quickAction(action: "pdf", options: Record<string, unknown>): Promise<Response> } | undefined} browser
 * @param {string} html
 * @param {{ what?: string, pdfOptions?: Record<string, unknown>, gotoOptions?: Record<string, unknown> }} [options]
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function quickPdf(
  browser,
  html,
  { what = "the PDF", pdfOptions = {}, gotoOptions = { waitUntil: "load" } } = {},
) {
  if (typeof browser?.quickAction !== "function")
    throw new Error(
      `The BROWSER binding is not configured on this Worker, so ${what} cannot be rendered.`,
    );
  const response = await browser.quickAction("pdf", { html, pdfOptions, gotoOptions });
  if (!response.ok)
    throw new Error(
      `Browser Rendering answered ${response.status} for ${what}: ${(await response.text()).slice(0, 300)}`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  assertPdf(bytes, what);
  return bytes;
}

/**
 * Reject when `promise` has not settled in `ms`.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
function within(promise, ms, what) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms.`)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout])).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * A PDF of a Paged.js page through a full browser. `origin` becomes the page's <base>, since the page has no address
 * of its own and names its scripts and fonts by path. Waits for the network, the fonts and Paged.js's completion mark,
 * then prints with the page's own @page size; the whole render is bounded by `timeoutMs`.
 * @param {{ launch(binding: never): Promise<any> }} puppeteer the site's `@cloudflare/puppeteer` default export
 * @param {unknown} browserBinding env.BROWSER
 * @param {string} html
 * @param {{ origin: string, what?: string, timeoutMs?: number, loadTimeoutMs?: number, pagedTimeoutMs?: number, pdfOptions?: Record<string, unknown> }} options
 * @returns {Promise<Uint8Array>}
 */
export async function pagedPdf(
  puppeteer,
  browserBinding,
  html,
  {
    origin,
    what = "the PDF",
    timeoutMs = 90_000,
    loadTimeoutMs = 60_000,
    pagedTimeoutMs = 60_000,
    pdfOptions = {},
  },
) {
  const browser = await puppeteer.launch(/** @type {never} */ (browserBinding));
  try {
    const based = html.replace(/<head>/i, `<head>\n<base href="${origin}/" />`);
    const render = async () => {
      const page = await browser.newPage();
      await page.setContent(based, { waitUntil: "networkidle0", timeout: loadTimeoutMs });
      // The real fonts before layout, so Paged.js never paginates against a fallback face.
      await page.evaluate("document.fonts.ready");
      await page.waitForFunction(
        `document.documentElement.getAttribute('${PAGED_DONE_ATTRIBUTE}') === 'true'`,
        {
          timeout: pagedTimeoutMs,
          polling: 200,
        },
      );
      // A short settle so the final layout paints before capture.
      await new Promise((resolve) => setTimeout(resolve, 300));
      /** @type {Uint8Array} */
      const bytes = await page.pdf({
        printBackground: true,
        format: "A4",
        preferCSSPageSize: true,
        ...pdfOptions,
      });
      assertPdf(bytes, what);
      return bytes;
    };
    return await within(render(), timeoutMs, `The render of ${what}`);
  } finally {
    await browser.close();
  }
}
