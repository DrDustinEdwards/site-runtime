import assert from "node:assert/strict";
import { test } from "node:test";
import { guardAnswerStream } from "../ai-ask.mjs";

test("an answer that keeps streaming is not cut for its length; the timeout is for silence", async () => {
  const encoder = new TextEncoder();
  const frames = [
    `event: chunks\ndata: ${JSON.stringify([{ slug: "a" }])}\n\n`,
    ...["One ", "two ", "three ", "four ", "five."].map(
      (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    ),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
  ];
  const upstream = new ReadableStream({
    async pull(controller) {
      const frame = frames.shift();
      if (frame === undefined) return controller.close();
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.enqueue(encoder.encode(frame));
    },
  });
  const guarded = guardAnswerStream(upstream, {
    resolveVisible: async (slugs) => new Set(slugs),
    citedSlugs: (chunks) => chunks.map((c) => /** @type {{ slug: string }} */ (c).slug),
    noAnswerText: "No answer.",
    timeoutMs: 150,
    checkProse: () => [],
  });
  const text = await new Response(guarded).text();
  assert.match(text, /One two three four five\./);
});
