/** The prose lines of a text and the author's excerpts and sentence spread read from them: the leaf the scan builds on. See ./prose.mjs. */

import { chunks, percentile, sentences, words } from "./prose-voice.mjs";

/** @import { Spread } from "./prose.mjs" */

/** Excerpt sentences shorter than this are left out of the spread ("Dr." and "Fig." cut by the splitter, "Yes."). */
const SPREAD_MIN_WORDS = 4;

/** Markdown reduced to the words a reader reads: link text kept, marks and code dropped. The bracket and tag runs are bounded or exclude their own opener, so a line of unclosed openers is linear. @param {string} line */
function readable(line) {
  return line
    .replace(/!\[[^\]]{0,500}\]\([^)]{0,2000}\)/g, "")
    .replace(/\[([^\]]{0,500})\]\([^)]{0,2000}\)/g, "$1")
    .replace(/<[^<>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(?:>\s?|[-*+]\s+|\d+\.\s+)/, "")
    .replace(/(\*\*|__|\*|_)(?=\S)([^*_]+?)\1/g, "$2");
}

/** A line that opens on a bold run: "**You can't skim out loud.** As an adult..." or "- **Group picks.** Nominate...". */
const BOLD_LEAD = /^\s{0,3}(?:[-*+]\s+|\d+\.\s+)?(?:\*\*|__)\S/;

/** The prose lines of a text with their line numbers, and whether each opens on a bold run: headings, code, tables and HTML blocks left out. @param {string} text @param {number} firstLine */
export function proseLines(text, firstLine) {
  /** @type {{ text: string, line: number, bold: boolean }[]} */
  const out = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced || /^\s*(?:#|\||<|---\s*$)/.test(raw)) return;
    out.push({ text: readable(raw), line: firstLine + i, bold: BOLD_LEAD.test(raw) });
  });
  return out;
}

/**
 * How long the author's sentences run, from their excerpts: the 10th percentile, the median and the 90th, over sentences
 * of four words or more. Null under five such sentences.
 * @param {string[]} excerpts
 * @returns {Spread | null}
 */
export function sentenceSpread(excerpts) {
  const lengths = excerpts
    .flatMap((e) => proseLines(e, 1).flatMap((l) => sentences(l.text)))
    .map((s) => words(s).length)
    .filter((n) => n >= SPREAD_MIN_WORDS)
    .sort((a, b) => a - b);
  if (lengths.length < 5) return null;
  return {
    short: percentile(lengths, 0.1),
    mid: percentile(lengths, 0.5),
    long: percentile(lengths, 0.9),
    longest: lengths[lengths.length - 1],
  };
}

/** A sentence quoted short enough for a list line. @param {string} s */
export function quote(s) {
  const ws = s.trim().split(/\s+/);
  return ws.length > 12 ? `${ws.slice(0, 10).join(" ")} …` : s.trim();
}

/** The paragraphs of a text's prose lines, each with the line it starts on and the line it ends on. @param {{ text: string, line: number }[]} lines */
export function paragraphsOf(lines) {
  /** @type {{ text: string, line: number, last: number }[]} */
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (!l.text.trim()) continue;
    if (prev && prev.last === l.line - 1) {
      prev.text += ` ${l.text}`;
      prev.last = l.line;
    } else out.push({ text: l.text, line: l.line, last: l.line });
  }
  return out;
}

/** A passage's excerpts: its ~300-word chunks, or the whole of a short post that still has something to show. @param {string} passage */
function excerptsOf(passage) {
  const own = chunks(passage);
  return own.length > 0 ? own : words(passage).length >= 50 ? [passage.trim()] : [];
}

/**
 * The excerpts a model writes from, from the author's passages (newest first): at most one per passage, chosen so the set
 * holds one of the author's long sentences and one of their short ones, and the rest are the newest passages as they
 * come. Not the passages nearest the author's average: those show a model one sentence length, and it writes that length.
 * @param {string[]} passages
 * @param {number} [count]
 * @returns {string[]}
 */
export function voiceExcerpts(passages, count = 6) {
  const pieces = passages.map(excerptsOf);
  const spread = sentenceSpread(passages);
  /** @type {Set<number>} */
  const used = new Set();
  /** @type {string[]} */
  const out = [];
  /** @param {(n: number) => boolean} test */
  const pick = (test) => {
    for (const [i, list] of pieces.entries()) {
      if (used.has(i)) continue;
      const hit = list.find((c) => sentences(c).some((s) => test(words(s).length)));
      if (hit) {
        used.add(i);
        out.push(hit);
        return;
      }
    }
  };
  if (spread) {
    pick((n) => n >= spread.long);
    pick((n) => n >= 2 && n <= spread.short);
  }
  for (const [i, list] of pieces.entries()) {
    if (out.length >= count) break;
    if (used.has(i) || list.length === 0) continue;
    used.add(i);
    out.push(list[0]);
  }
  return out.slice(0, count);
}
