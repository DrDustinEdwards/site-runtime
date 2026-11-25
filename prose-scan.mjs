/** The scan after a draft: what reads unlike the author's excerpts, as spans to fix. See ./prose.mjs. */

import { words, sentences, per1000, percentile } from "./prose-voice.mjs";
import {
  CLOSING_TRIAD,
  DASH,
  NOT_JUST,
  OUT_OF_PLACE,
  PATTERNS,
  TELLS,
  around,
  phraseRegExp,
} from "./prose-habits.mjs";
import { paragraphsOf, proseLines, quote, sentenceSpread } from "./prose-lines.mjs";
/** @import { Spread } from "./prose.mjs" */

/** The most findings one scan returns: past a dozen, a session rewrites instead of editing. */
const MAX_FINDINGS = 12;

/** @typedef {"length" | "filler" | "word" | "shape" | "detail" | "source"} SlopKind */
/** @import { SlopFinding } from "./prose.mjs" */

/** Joiner dashes per 1,000 words of the excerpts: an author who writes a dash a page keeps theirs. @param {string} text */
function dashRate(text) {
  return per1000(text.match(DASH)?.length ?? 0, words(text).length);
}

/** A definition as a first sentence ("Groundwater is water that fills the cracks in rock"); "It is estimated that" is not one. */
const DEFINITION =
  /^(?!(?:it|this|that|there|these|those|here)\s)(?:an?\s+|the\s+)?[\p{L}-]+(?:\s+[\p{L}-]+){0,3}\s+(?:is|are)\s+(?:an?\s+|the\s+)?(?:[\p{L}-]+\s+){0,3}[\p{L}-]+\s+(?:that|which|who|used|where|in which)\b/iu;
/** A last sentence that sums up instead of stopping ("This is one reason that...", "In the end,"). */
const WRAP_UP =
  /^(?:this is (?:one reason|why|what|how|the reason)|that(?:['’]s| is) (?:why|what|how)|which is why|in short|in the end|ultimately|overall|in other words|all of this|the result is|the lesson|so the next time)\b/iu;
/** A passive verb: a form of "be" and a past participle ("is determined", "were tested", "has been shown"). "Was supposed to",
 * "is used to" and a feeling ("was tired") are not passives. */
const PASSIVE =
  /\b(?:is|are|was|were|be|been|being)\s+(?:(?:\p{L}+ly|also|often|not|never|still|then|now|first|always)\s+)?(?!(?:supposed|used|tired|scared|worried|excited|interested|pleased|married|born)\b)(?:\p{L}+ed|known|shown|seen|given|taken|made|found|done|built|written|driven|held|kept|told|brought|caught|left|lost|paid|run|set|sent|spent|thought|understood|won|grown|drawn|chosen|begun|broken|hidden|bound|fed|led|met|put|read|said|sold|struck|worn)\b/iu;
/** A sentence opened with "So", "And" or "But" for effect. */
const CONJUNCTION_OPENER = /^(?:So|And|But)\s+\p{L}/u;
/** Words in the stinger a paragraph ends on ("There is a cost."). */
const STINGER_WORDS = [2, 5];
/** An excerpt paragraph shorter than this does not set the author's floor for detail. */
const DETAIL_MIN_WORDS = 40;
/** A draft paragraph shorter than this is not weighed for detail. */
const DETAIL_DRAFT_MIN_WORDS = 25;
/**
 * A capitalized word that is not a specific: "I", and acronyms ("API", "PDF", "mRNA"), which in any field mostly name a kind of
 * thing rather than a particular one the way "Larkspur" does. A rule, not a list, so no one field's vocabulary is built in.
 */
const isGenericCaps = (/** @type {string} */ w) => w === "I" || /^[a-z]{0,2}[A-Z]{2,}s?$/.test(w);

/** Specific things per 100 words: numbers, and capitalized words that do not open a sentence (names, places, species). @param {string} text */
function detailRate(text) {
  let hits = 0;
  let total = 0;
  for (const s of sentences(text)) {
    const ws = s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
    total += ws.length;
    ws.forEach((w, i) => {
      if (/\d/.test(w) || (i > 0 && /^\p{Lu}/u.test(w) && !isGenericCaps(w))) hits++;
    });
  }
  return total ? (hits / total) * 100 : 0;
}

/** How specific the author's plainer paragraphs are: the 10th percentile of their paragraphs' detail. Null under three paragraphs of forty words. @param {string[]} excerpts */
function detailFloor(excerpts) {
  const rates = excerpts
    .flatMap((e) => paragraphsOf(proseLines(e, 1)))
    .filter((p) => p.text.split(/\s+/).length >= DETAIL_MIN_WORDS)
    .map((p) => detailRate(p.text))
    .sort((a, b) => a - b);
  return rates.length < 3 ? null : percentile(rates, 0.1);
}

/** A last question put to the reader: "Want to look at that passage together?", "What was it about the ending that didn't work for you?" */
const ASKS_THE_READER = /\byou(?:r)?\b|^(?:want|shall|ready|curious)\b/iu;

/** A word or number as the sources would hold it: "52,960" and "52960" alike. @param {string} w */
function keyOf(w) {
  return /^[\d.,]+$/.test(w) ? w.replace(/,/g, "") : w.toLowerCase();
}

/** The names and numbers in a text, sentence by sentence: what `detailRate` counts. @param {string} text */
function specificsOf(text) {
  return sentences(text).map((s) =>
    (s.match(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu) ?? []).filter(
      (w, i) => /\d/.test(w) || (i > 0 && /^\p{Lu}/u.test(w) && !isGenericCaps(w)),
    ),
  );
}

/**
 * Names and numbers in the draft found in neither the sources nor the author's writing: a claim nobody can check. With
 * sources given, one finding per sentence naming them; with none, one finding asking for them.
 * @param {{ text: string, line: number }[]} paragraphs @param {string[]} known @param {boolean} given
 * @returns {SlopFinding[]}
 */
function unsourced(paragraphs, known, given) {
  const have = new Set(
    known.flatMap((k) =>
      (k.match(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu) ?? []).flatMap((w) => [
        keyOf(w),
        ...w.split(/[-'’]/).map(keyOf),
      ]),
    ),
  );
  const isKnown = (/** @type {string} */ w) =>
    have.has(keyOf(w)) || w.split(/[-'’]/).every((part) => have.has(keyOf(part)));
  /** @type {SlopFinding[]} */
  const out = [];
  for (const p of paragraphs) {
    const missing = specificsOf(p.text).map((ws) => [...new Set(ws.filter((w) => !isKnown(w)))]);
    missing.forEach((ws, j) => {
      if (!ws.length) return;
      const names = ws.map((w) => `"${w}"`).join(", ");
      if (given)
        out.push({
          kind: "source",
          excerpt: quote(sentences(p.text)[j]),
          line: p.line,
          say: `${names} ${ws.length === 1 ? "is" : "are"} not in the sources or the author's writing. Check it against a source and add the source, or cut it.`,
        });
    });
    if (!given && missing.some((ws) => ws.length) && !out.length) {
      out.push({
        kind: "source",
        excerpt: quote(p.text),
        line: p.line,
        say: "This draft names things that are not in the author's writing, and no sources were given. List the sources the draft used and scan again.",
      });
    }
  }
  return out;
}

/** A paragraph of three or more sentences that ends on one of two to five words. @param {string} text */
function isStinger(text) {
  const ss = sentences(text);
  const n = words(ss.at(-1) ?? "").length;
  return ss.length >= 3 && n >= STINGER_WORDS[0] && n <= STINGER_WORDS[1];
}

/**
 * The scan after a draft: what in it reads unlike the author's excerpts, as spans a session can fix in place. No model
 * and no detector. Six kinds:
 * - `length`: a sentence well past the author's long ones, or four or more in a row of the same length when the author's
 *   own vary (measured from the excerpts; skipped under five excerpt sentences of four words or more);
 * - `filler`: a phrase in `TELLS`, or a chatbot's refusal, note on its training, blank or markup (`PATTERNS`);
 * - `word`: a short closed list of a model's words (OUT_OF_PLACE), each only when the excerpts never use it;
 * - `shape`: a dash used as a joiner, "not X, it's Y" (and "X, not Y"), a paragraph ending on three padded words or on a
 *   two-to-five-word stinger, a "So"/"And"/"But" opener, a bold lead-in and a question to the reader, each only when the
 *   excerpts do not write that way themselves (a dash between numbers is a range and passes); and in every draft a
 *   definition opening, a wrap-up ending, a last sentence asking the reader something, and the passive voice;
 * - `detail`: a paragraph of 25 words or more with under half the specifics of the excerpts' plainer paragraphs ("DNA" and
 *   the like are kinds of thing, not specifics);
 * - `source`: with `sources` given (the text of what the draft drew on), each sentence naming a name or number found in
 *   neither the sources nor the excerpts; with `sources` empty, one finding asking for them. Left out when `sources` is not
 *   passed.
 * At most twelve findings, in line order. `instruction` is what to hand the session that wrote the draft, null when there
 * is nothing to fix. `firstLine` is the file line `text` starts on.
 * @param {string} text
 * @param {string[]} excerpts
 * @param {{ firstLine?: number, sources?: string[] }} [options]
 * @returns {{ findings: SlopFinding[], instruction: string | null, spread: Spread | null }}
 */
export function slopScan(text, excerpts, options = {}) {
  const firstLine = options.firstLine ?? 1;
  const lines = proseLines(text, firstLine);
  const source = excerpts.join("\n\n");
  const theirs = new Set(words(source));
  const spread = sentenceSpread(excerpts);
  /** @type {SlopFinding[]} */
  const found = [];

  // Length, over the draft's sentences in reading order.
  if (spread) {
    const sents = lines.flatMap((l) =>
      sentences(l.text).map((s) => ({ s, n: words(s).length, line: l.line })),
    );
    // Past the excerpts' long sentences by eight words, and past their longest: a length the author writes is theirs.
    const limit = Math.max(spread.long + 7, spread.longest);
    for (const { s, n, line } of sents) {
      if (n > limit) {
        found.push({
          kind: "length",
          excerpt: quote(s),
          line,
          say: `This is ${n} words. The long sentences in the excerpts are about ${spread.long}. Split it where the subject changes.`,
        });
      }
    }
    if (spread.long - spread.short >= 10) {
      for (let i = 0; i + 4 <= sents.length;) {
        let end = i + 1;
        let lo = sents[i].n;
        let hi = sents[i].n;
        while (end < sents.length && Math.max(hi, sents[end].n) - Math.min(lo, sents[end].n) <= 2) {
          lo = Math.min(lo, sents[end].n);
          hi = Math.max(hi, sents[end].n);
          end++;
        }
        const run = sents.slice(i, end);
        const m = Math.round(run.reduce((a, r) => a + r.n, 0) / run.length);
        // A run of fragments at or under the author's short sentences is a device ("I turned it over. My name, in
        // pencil."), not the even middle length a model settles into.
        if (run.length >= 4 && m > spread.short) {
          found.push({
            kind: "length",
            excerpt: quote(run[0].s),
            line: run[0].line,
            say: `These ${run.length === 4 ? "four" : run.length} sentences are all about ${m} words. The excerpts run from ${spread.short} to ${spread.long}. Break one, or join two, where the sense allows. Do not alternate short and long on purpose.`,
          });
          i = end;
        } else i++;
      }
    }
  }

  const outOfPlace = OUT_OF_PLACE.filter((w) => !theirs.has(w));
  const dashesAreTheirs = dashRate(source) >= 1;
  const notXIsTheirs = excerpts.some((e) => NOT_JUST.some((re) => re.test(e.replace(/\s+/g, " "))));

  lines.forEach(({ text: line, line: n }, i) => {
    /** @type {[number, number][]} */
    const filled = [];
    for (const [phrase, say] of TELLS) {
      for (const m of line.matchAll(phraseRegExp(phrase))) {
        filled.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
        found.push({ kind: "filler", excerpt: m[0], line: n, say });
      }
    }
    for (const { re, say } of PATTERNS) {
      for (const m of line.matchAll(re))
        found.push({ kind: "filler", excerpt: m[0].trim(), line: n, say });
    }
    for (const word of outOfPlace) {
      for (const m of line.matchAll(phraseRegExp(word))) {
        const at = m.index ?? 0;
        if (filled.some(([a, b]) => at >= a && at < b)) continue;
        found.push({
          kind: "word",
          excerpt: m[0],
          line: n,
          say: "This word is not in the excerpts. Use the plain word the excerpts would use, or cut it and keep the fact.",
        });
      }
    }
    if (!dashesAreTheirs) {
      for (const m of line.matchAll(DASH)) {
        // Between two numbers it is a range (2019—2024), not a joiner.
        if (
          /\d$/.test(line.slice(0, m.index ?? 0)) &&
          /^\d/.test(line.slice((m.index ?? 0) + m[0].length))
        )
          continue;
        found.push({
          kind: "shape",
          excerpt: around(line, m.index ?? 0, m[0].length),
          line: n,
          say: "Make this two sentences, or a comma if it is one thought.",
        });
      }
    }
    if (!notXIsTheirs) {
      const next = lines[i + 1]?.text.trim() ? ` ${lines[i + 1].text}` : "";
      const hit = NOT_JUST.map((re) => {
        const own = re.exec(line);
        if (own) return own;
        const m = next ? re.exec(line + next) : null;
        return m && (m.index ?? 0) < line.length && (m.index ?? 0) + m[0].length > line.length
          ? m
          : null;
      }).find(Boolean);
      if (hit)
        found.push({
          kind: "shape",
          excerpt: hit[0].trim(),
          line: n,
          say: 'Say what it is. "Not X, it\'s Y" sets up a claim nobody made.',
        });
    }
    // A paragraph's last line: the next line is blank or there is none.
    const last = !lines[i + 1] || !lines[i + 1].text.trim() || lines[i + 1].line !== n + 1;
    const triad = last ? CLOSING_TRIAD.exec(line.trim()) : null;
    if (triad) {
      const padded = [triad[2], triad[3], triad[4]].filter((item) =>
        words(item).some((w) => outOfPlace.includes(w)),
      ).length;
      if (padded >= 2) {
        // The list's own words are this finding's to fix, not three more.
        for (let k = found.length - 1; k >= 0; k--) {
          if (
            found[k].kind === "word" &&
            found[k].line === n &&
            triad[1].toLowerCase().includes(found[k].excerpt.toLowerCase())
          )
            found.splice(k, 1);
        }
        found.push({
          kind: "shape",
          excerpt: triad[1].trim(),
          line: n,
          say: "This list is padding. End on the fact. Keep a list of three only when the three things are real.",
        });
      }
    }
  });

  // The shape of the whole piece. Detail, stingers and "So"/"And"/"But" openers are weighed against the excerpts; a
  // definition opening, a wrap-up ending and the passive are the Owner's rules for every draft (WRITING_RULES).
  const theirParagraphs = excerpts.flatMap((e) => paragraphsOf(proseLines(e, 1)));
  const stingersAreTheirs = theirParagraphs.some((p) => isStinger(p.text));
  // About one in every two thousand words, as an author who writes that way does; a formal writer's one "And third," in a
  // paper is not a habit.
  const openersAreTheirs =
    per1000(
      theirParagraphs.flatMap((p) => sentences(p.text)).filter((t) => CONJUNCTION_OPENER.test(t))
        .length,
      words(source).length,
    ) >= 0.5;
  const paragraphs = paragraphsOf(lines);
  const floor = detailFloor(excerpts);
  if (floor !== null) {
    for (const p of paragraphs) {
      if (p.text.split(/\s+/).length < DETAIL_DRAFT_MIN_WORDS) continue;
      if (detailRate(p.text) < floor / 2) {
        found.push({
          kind: "detail",
          excerpt: quote(sentences(p.text)[0] ?? p.text),
          line: p.line,
          say: "Nothing in this paragraph is specific: no number, name, place or thing that happened. Put in the specific case it is about, or cut it.",
        });
      }
    }
  }
  const opening = sentences(paragraphs[0]?.text ?? "")[0];
  if (opening && DEFINITION.test(opening)) {
    found.push({
      kind: "shape",
      excerpt: quote(opening),
      line: paragraphs[0].line,
      say: "This opens on a definition the reader already knows. Start with the case, the finding or the question.",
    });
  }
  const closing = paragraphs.length
    ? sentences(paragraphs[paragraphs.length - 1].text).at(-1)
    : undefined;
  if (closing && WRAP_UP.test(closing)) {
    found.push({
      kind: "shape",
      excerpt: quote(closing),
      line: paragraphs[paragraphs.length - 1].last,
      say: "This sums up what was just said. Cut it and end on the last fact.",
    });
  }
  const boldIsTheirs = excerpts.some((e) => proseLines(e, 1).some((l) => l.bold));
  if (!boldIsTheirs) {
    for (const l of lines)
      if (l.bold)
        found.push({
          kind: "shape",
          excerpt: quote(l.text),
          line: l.line,
          say: "A bold lead-in. Make it a plain first sentence, or cut it.",
        });
  }
  // A question to the reader: weighed against the excerpts, except that a piece never ends by asking the reader something.
  const questionsAreTheirs =
    per1000(
      theirParagraphs.flatMap((p) => sentences(p.text)).filter((t) => t.endsWith("?")).length,
      words(source).length,
    ) >= 0.5;
  paragraphs.forEach((p, k) => {
    const ss = sentences(p.text);
    ss.forEach((t, j) => {
      if (!t.endsWith("?")) return;
      if (k === paragraphs.length - 1 && j === ss.length - 1 && ASKS_THE_READER.test(t)) {
        found.push({
          kind: "shape",
          excerpt: quote(t),
          line: p.last,
          say: "This ends by asking the reader something. Stop on the last fact.",
        });
      } else if (!questionsAreTheirs) {
        found.push({
          kind: "shape",
          excerpt: quote(t),
          line: p.line,
          say: "A question to the reader. Say the answer instead.",
        });
      }
    });
  });
  if (options.sources)
    found.push(...unsourced(paragraphs, [...options.sources, source], options.sources.length > 0));
  for (const p of paragraphs) {
    if (!stingersAreTheirs && isStinger(p.text))
      found.push({
        kind: "shape",
        excerpt: sentences(p.text).at(-1) ?? "",
        line: p.last,
        say: "A short line to end the paragraph on a beat. Fold it into the sentence before, or cut it.",
      });
    for (const t of sentences(p.text)) {
      if (!openersAreTheirs && CONJUNCTION_OPENER.test(t))
        found.push({
          kind: "shape",
          excerpt: quote(t),
          line: p.line,
          say: `Drop the opening "${t.split(/\s/)[0]}" and say the sentence plainly.`,
        });
      const passive = PASSIVE.exec(t);
      if (passive)
        found.push({
          kind: "shape",
          excerpt: passive[0],
          line: p.line,
          say: "Passive. Name who did it and make them the subject.",
        });
    }
  }

  const findings = found.sort((a, b) => a.line - b.line).slice(0, MAX_FINDINGS);
  return { findings, instruction: instructionFor(findings, spread), spread };
}

/**
 * The one instruction for a session that wrote a draft: edit the listed spans in place and nothing else. Null with no
 * findings. Exported so a caller that adds findings of its own (a run copied from an excerpt) hands over one list.
 * @param {{ excerpt: string, line: number | null, say: string }[]} findings
 * @param {Spread | null} spread
 * @returns {string | null}
 */
export function instructionFor(findings, spread) {
  if (findings.length === 0) return null;
  const head = [
    "Edit the draft in place. Change only the spans listed. Keep every fact, name, number, and link. Leave every other sentence as it is.",
    ...(spread
      ? [
          `The excerpts' sentences run about ${spread.short}, ${spread.mid}, and ${spread.long} words. Stay inside that spread. Do not alternate short and long on purpose.`,
        ]
      : []),
  ];
  return [
    ...head,
    ...findings.map(
      (f) => `- ${f.line === null ? "" : `Line ${f.line}, `}"${f.excerpt}": ${f.say}`,
    ),
  ].join("\n");
}
