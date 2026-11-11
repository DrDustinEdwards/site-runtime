import assert from "node:assert/strict";
import { test } from "node:test";

import { partText, readMultipart } from "../body.mjs";

const BOUNDARY = "----sample";
const CRLF = "\r\n";

/** A multipart request whose body arrives in chunks of `size` bytes, so boundaries fall across reads. */
function upload(parts, size) {
  const text =
    parts
      .map(
        ([name, value, file]) =>
          `--${BOUNDARY}${CRLF}Content-Disposition: form-data; name="${name}"${file ? `; filename="${file}"${CRLF}Content-Type: Application/PDF` : ""}${CRLF}${CRLF}${value}${CRLF}`,
      )
      .join("") + `--${BOUNDARY}--${CRLF}`;
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
  return new Request("https://example.com/upload", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
    body,
    duplex: "half",
  });
}

async function readAll(request, max) {
  const out = [];
  for await (const part of readMultipart(request, max)) {
    if (part.name === "skip") continue; // left unread: the reader skips it
    out.push({
      name: part.name,
      filename: part.filename,
      type: part.type,
      value: await partText(part),
    });
  }
  return out;
}

test("readMultipart yields each part with its bytes whole, wherever the reads split the boundaries", async () => {
  const file = `%PDF ${"x".repeat(300)}\r\n-- not a boundary --${BOUNDARY.slice(0, 5)}`;
  for (const size of [1, 7, 64, 4096]) {
    const parts = await readAll(
      upload(
        [
          ["title", "Sample"],
          ["skip", "unread value"],
          ["file", file, "sample.pdf"],
        ],
        size,
      ),
      1 << 20,
    );
    assert.deepEqual(
      parts,
      [
        { name: "title", filename: null, type: "", value: "Sample" },
        { name: "file", filename: "sample.pdf", type: "application/pdf", value: file },
      ],
      `chunk size ${size}`,
    );
  }
});

test("readMultipart refuses a body over its ceiling with the 413 and one that is not multipart with a 400", async () => {
  await assert.rejects(
    readAll(upload([["file", "y".repeat(5000), "a.pdf"]], 512), 1000),
    (r) => r.status === 413,
  );
  const plain = new Request("https://example.com/upload", { method: "POST", body: "a=1" });
  await assert.rejects(readAll(plain, 1000), (r) => r.status === 400);
  const cut = new Request("https://example.com/upload", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
    body: `--${BOUNDARY}${CRLF}Content-Disposition: form-data; name="a"${CRLF}${CRLF}never ends`,
  });
  await assert.rejects(readAll(cut, 1000), (r) => r.status === 400);
});
