/**
 * What a public "ask" box over a site's own writing needs between the model and the reader, from dustinedwards.info's
 * Ask (app/lib/search/sse.mjs, ask-prompt.mjs, ask-guard.server.ts): the event-stream frames read one way, the cache
 * key of a question, and the guard that shows an answer a paragraph at a time and ends it where a check refuses.
 * The budget in front of it is ./ai-caps; the site keeps its prompt, its retrieval and what a citation means.
 *
 * The upstream is OpenAI's stream shape (`choices[0].delta.content`, `finish_reason`), which Cloudflare AI Search
 * streams, with one `event: chunks` frame naming the passages the answer was written from.
 */

import { sha256Hex } from "./encoding.mjs";
import { logEvent } from "./log.mjs";
import { checkProse as defaultCheckProse } from "./prose.mjs";

/** The event the guard sends after an answer the model did not finish, so the reader is told it was cut. */
export const CUT_EVENT = "cut";

/**
 * One frame's event name and its data lines joined, each with its `data:` prefix removed.
 * @param {string} frame one frame, without its blank-line terminator
 * @returns {{ event: string, data: string }}
 */
export function frameFields(frame) {
  let event = "";
  /** @type {string[]} */
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join("\n") };
}

/**
 * The complete frames off the front of a buffer, with the unfinished tail as `rest`. A frame with no data, the `[DONE]`
 * sentinel, or data that is not JSON carries nothing to show and is left out.
 * @param {string} buffer everything decoded and not yet consumed
 * @returns {{ frames: Array<{ event: string, data: unknown }>, rest: string }}
 */
export function takeSseFrames(buffer) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  /** @type {Array<{ event: string, data: unknown }>} */
  const frames = [];
  for (const part of parts) {
    const { event, data } = frameFields(part);
    if (!data || data === "[DONE]") continue;
    try {
      frames.push({ event, data: JSON.parse(data) });
    } catch {
      continue;
    }
  }
  return { frames, rest };
}

/**
 * The text a completion frame adds to the answer, or undefined for a frame that adds none.
 * @param {unknown} data a parsed frame's data
 * @returns {string | undefined}
 */
export function answerDelta(data) {
  const delta = /** @type {{ choices?: Array<{ delta?: { content?: unknown } }> } | null} */ (data)
    ?.choices?.[0]?.delta?.content;
  return typeof delta === "string" ? delta : undefined;
}

/**
 * Why the model stopped, from a frame's `choices[0].finish_reason`, or undefined for a frame that does not say.
 * `"stop"` is a finished answer; `"length"` one cut at `max_tokens`.
 * @param {unknown} data a parsed frame's data
 * @returns {string | undefined}
 */
export function finishReason(data) {
  const reason = /** @type {{ choices?: Array<{ finish_reason?: unknown }> } | null} */ (data)
    ?.choices?.[0]?.finish_reason;
  return typeof reason === "string" && reason.length > 0 ? reason : undefined;
}

/**
 * A question as its cache key sees it: lowercased, whitespace collapsed, trailing punctuation dropped. No stemming or
 * stopword dropping: differently worded questions must not share an answer.
 * @param {string} question
 */
export function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.,;:]+$/g, "")
    .trim();
}

/**
 * The key a question's answer is cached under: `prefix` and the SHA-256 of the normalized question, so a prefix scan
 * (KV list) can drop every cached answer at once.
 * @param {string} question
 * @param {string} [prefix] default `ask:answer:`
 */
export async function answerKey(question, prefix = "ask:answer:") {
  return `${prefix}${await sha256Hex(normalizeQuestion(question))}`;
}

/**
 * A cached answer as the frames the live one sends: the chunks, the text, the end.
 * @param {{ answer: string, chunks: unknown[] }} cached
 * @returns {string[]}
 */
export function replayFrames(cached) {
  return [
    `event: chunks\ndata: ${JSON.stringify(cached.chunks)}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: cached.answer } }] })}\n\n`,
    `data: [DONE]\n\n`,
  ];
}

/** @param {string} reason */
function unverifiable(reason) {
  logEvent("ask_guard_unverifiable", { reason }, { level: "error" });
}

/**
 * Where the first finished paragraph of `text` ends (after its blank line), or -1 while none has.
 * @param {string} text
 */
function paragraphEnd(text) {
  const blank = /\n[ \t]*\n/.exec(text);
  return blank ? blank.index + blank[0].length : -1;
}

const DONE_FRAME = "data: [DONE]\n\n";

/**
 * The answer shown a paragraph at a time: each is held until its blank line (or the end of the stream), checked whole,
 * and only then sent. The chunks frame is checked first (a refusal there stops the model at once) and is held with the
 * first paragraph, so no citations show for an answer that never does. A refused paragraph ends the answer where it
 * stands; if nothing was shown yet, `noAnswerText` takes its place. `onRefused` hears every refusal, and the caller must
 * not cache that answer: a cut answer is not the answer. Only the chunks frame and the text reach the reader.
 *
 * - A zero-chunk answer came from the model's weights, not the site, and is replaced. FAILS CLOSED: a chunks frame that
 *   is not a JSON array, or a stream that ends without one, cannot be checked, so it is replaced too and logged as
 *   `ask_guard_unverifiable`, which is how a changed upstream frame order shows up.
 * - A chunks frame citing anything `resolveVisible` does not return refuses the whole answer, not just the link: the
 *   prose was written from those passages.
 * - A paragraph `checkProse` flags at high severity is not shown.
 * - An answer the model did not finish (a `finish_reason` other than `stop`) is shown as far as it got, then a `cut` event
 *   names the reason; `onCut` hears it, and the caller must not cache that answer either.
 * - A stalled upstream ends the answer after `timeoutMs`.
 * @param {ReadableStream} upstream
 * @param {{
 *   resolveVisible: (slugs: string[]) => Promise<Set<string>>,
 *   citedSlugs: (chunks: unknown[]) => string[],
 *   noAnswerText: string,
 *   timeoutMs?: number,
 *   checkProse?: (paragraph: string) => Array<{ check: string, severity: string }>,
 *   onRefused?: () => void,
 *   onCut?: (reason: string) => void,
 * }} options `citedSlugs` is what a chunk cites on this site (a chunk naming nothing contributes nothing);
 *   `resolveVisible` answers which of those a reader may see
 * @returns {ReadableStream}
 */
export function guardAnswerStream(
  upstream,
  {
    resolveVisible,
    citedSlugs,
    noAnswerText,
    timeoutMs = 20_000,
    checkProse = defaultCheckProse,
    onRefused = () => {},
    onCut = () => {},
  },
) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /** Whether the chunks frame refuses the answer: empty, not a JSON array, or citing what a reader may not see. @param {string} frame */
  async function chunksRefused(frame) {
    let empty = false;
    let bad = false;
    /** @type {unknown[]} */
    let chunks = [];
    try {
      const parsed = JSON.parse(frameFields(frame).data);
      if (Array.isArray(parsed)) {
        chunks = parsed;
        empty = parsed.length === 0;
      } else bad = true;
    } catch {
      bad = true;
    }
    if (bad) unverifiable("the chunks frame is not a JSON array");
    const slugs = citedSlugs(chunks);
    let leaked = false;
    if (!empty && !bad && slugs.length > 0) {
      const visible = await resolveVisible(slugs);
      leaked = slugs.some((slug) => !visible.has(slug));
    }
    return empty || leaked || bad;
  }

  /**
   * The next read, or a rejection once `deadline` passes.
   * @param {ReadableStreamDefaultReader} reader
   * @param {number} deadline
   */
  function readBy(reader, deadline) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`the answer took longer than ${timeoutMs} ms`)),
        deadline - Date.now(),
      );
    });
    return Promise.race([reader.read(), late]).finally(() => clearTimeout(timer));
  }

  return new ReadableStream({
    async start(controller) {
      /** @param {string} text */
      const send = (text) => controller.enqueue(encoder.encode(text));
      const reader = upstream.getReader();
      const deadline = Date.now() + timeoutMs;
      let buffer = "";
      // Answer text not yet checked: the unfinished paragraph.
      let text = "";
      /** @type {string | null} */
      let chunksFrame = null;
      let shown = false;
      /** @type {string | undefined} */
      let stopped;

      const refuse = async () => {
        onRefused();
        await reader.cancel().catch(() => {});
        if (shown) send(DONE_FRAME);
        else for (const piece of replayFrames({ answer: noAnswerText, chunks: [] })) send(piece);
        controller.close();
      };

      /** Sends a paragraph that passes; false for one that does not. @param {string} paragraph */
      const release = (paragraph) => {
        const findings = checkProse(paragraph)
          .filter((issue) => issue.severity === "high")
          .map((issue) => issue.check);
        if (findings.length > 0) {
          logEvent("ask_answer_refused_prose", { checks: findings }, { level: "error" });
          return false;
        }
        if (!shown) send(`${chunksFrame}\n\n`);
        shown = true;
        if (paragraph)
          send(`data: ${JSON.stringify({ choices: [{ delta: { content: paragraph } }] })}\n\n`);
        return true;
      };

      try {
        for (;;) {
          const { done, value } = await readBy(reader, deadline);
          // At the end, a closing blank line finishes a last frame the upstream left open.
          buffer += done ? `${decoder.decode()}\n\n` : decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const { event, data } = frameFields(frame);
            if (event === "chunks") {
              if (chunksFrame !== null) continue;
              chunksFrame = frame;
              if (await chunksRefused(frame)) return await refuse();
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              text += answerDelta(parsed) ?? "";
              stopped = finishReason(parsed) ?? stopped;
            } catch {
              // [DONE], a keep-alive or a frame that is not JSON carries no text.
            }
          }

          // Nothing is released before the chunks frame passes: until then no paragraph can be checked.
          if (chunksFrame !== null) {
            for (let end = paragraphEnd(text); end !== -1; end = paragraphEnd(text)) {
              if (!release(text.slice(0, end))) return await refuse();
              text = text.slice(end);
            }
          }
          if (done) break;
        }

        // Closed without ever showing a chunks event: nothing held can be checked, so none of it is shown.
        if (chunksFrame === null) {
          unverifiable("the stream ended without a chunks frame");
          return await refuse();
        }
        if (!release(text)) return await refuse();
        if (stopped !== undefined && stopped !== "stop") {
          onCut(stopped);
          send(`event: ${CUT_EVENT}\ndata: ${JSON.stringify({ reason: stopped })}\n\n`);
        }
        send(DONE_FRAME);
        controller.close();
      } catch (error) {
        await reader.cancel().catch(() => {});
        controller.error(error);
      }
    },
  });
}
