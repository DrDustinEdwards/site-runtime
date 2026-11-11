import assert from "node:assert/strict";
import { test } from "node:test";

import { contentDisposition, r2ObjectResponse } from "../r2-object.mjs";

const BYTES = new TextEncoder().encode("0123456789");

/** An R2 bucket holding one object, answering ranges as R2 does (offset/length or suffix in `range`). */
function bucket() {
  const meta = {
    size: BYTES.length,
    httpEtag: '"abc"',
    writeHttpMetadata: (h) => h.set("content-type", "application/pdf"),
  };
  return {
    head: async (key) => (key === "cv.pdf" ? meta : null),
    get: async (key, options) => {
      if (key !== "cv.pdf") return null;
      const header = options?.range?.get("range");
      if (!header) return { ...meta, body: new Blob([BYTES]).stream() };
      const [, from, to] = /^bytes=(\d*)-(\d*)$/.exec(header) ?? [];
      if (from === "") {
        const suffix = Number(to);
        return { ...meta, range: { suffix }, body: new Blob([BYTES.slice(-suffix)]).stream() };
      }
      const offset = Number(from);
      if (offset >= BYTES.length) throw new Error("InvalidRange");
      const end = to === "" ? BYTES.length - 1 : Math.min(Number(to), BYTES.length - 1);
      return {
        ...meta,
        range: { offset, length: end - offset + 1 },
        body: new Blob([BYTES.slice(offset, end + 1)]).stream(),
      };
    },
  };
}

const ask = (headers = {}, method = "GET") =>
  r2ObjectResponse(
    new Request("https://example.com/cv.pdf", { method, headers }),
    bucket(),
    "cv.pdf",
    {
      cacheControl: "public, max-age=300",
      disposition: "inline",
      filename: "cv.pdf",
    },
  );

test("r2ObjectResponse answers whole, HEAD, 304, ranges and a range past the end as a file server does", async () => {
  const whole = await ask();
  assert.equal(whole.status, 200);
  assert.equal(await whole.text(), "0123456789");
  assert.equal(whole.headers.get("content-length"), "10");
  assert.equal(whole.headers.get("x-content-type-options"), "nosniff");
  assert.equal(whole.headers.get("content-disposition"), 'inline; filename="cv.pdf"');

  const head = await ask({}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");

  const same = await ask({ "if-none-match": 'W/"abc", "other"' });
  assert.equal(same.status, 304);
  assert.equal(same.headers.get("cache-control"), "public, max-age=300");

  const part = await ask({ range: "bytes=2-4" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await part.text(), "234");

  const tail = await ask({ range: "bytes=-3" });
  assert.equal(tail.headers.get("content-range"), "bytes 7-9/10");
  assert.equal(await tail.text(), "789");

  const past = await ask({ range: "bytes=20-" });
  assert.equal(past.status, 416);
  assert.equal(past.headers.get("content-range"), "bytes */10");

  assert.equal((await ask({}, "POST")).status, 405);
  const missing = await r2ObjectResponse(new Request("https://example.com/x"), bucket(), "x");
  assert.equal(missing.status, 404);
});

test("contentDisposition keeps an ASCII name and adds filename* for any other", () => {
  assert.equal(
    contentDisposition("attachment", 'Program "final".pdf'),
    'attachment; filename="Program final.pdf"',
  );
  assert.equal(
    contentDisposition("attachment", "Résumé.pdf"),
    "attachment; filename=\"R_sum_.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf",
  );
  assert.equal(contentDisposition("inline"), "inline");
});
