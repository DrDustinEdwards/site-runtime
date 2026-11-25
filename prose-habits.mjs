/** The tells, patterns and out-of-place words `checkProse` flags, and the rules a model is told before it writes. See ./prose.mjs. */

/** @typedef {"critical" | "high" | "medium" | "low"} Severity */
/** @import { ProseIssue } from "./prose.mjs" */

/**
 * The sections of Wikipedia's field guide to AI writing that the checks map to ("Wikipedia:Signs of AI writing",
 * WikiProject AI Cleanup, read 2026-10-30), so a flag can say which known sign it is. The page lists observations, not
 * rules; it files em dashes (2022 to September 2026), knowledge-cutoff statements and prompt refusals under historical
 * signs. A cutoff statement or a refusal left in the text is still an error, whoever wrote the rest.
 */
export const SIGNS = {
  significance: "Undue emphasis on significance, legacy, and broader trends",
  promotional: "Promotional and advertisement-like language",
  vocabulary: 'High density of "AI vocabulary" words',
  parallelism: "Negative parallelisms",
  three: "Rule of three",
  collaborative: "Collaborative communication",
  placeholder: "Phrasal templates and placeholder text",
  markup: "Markup irregularities",
  cutoff: "Statements about knowledge cutoffs",
  refusal: "Prompt refusal",
  dash: "Overuse of em dashes",
};

/**
 * "It's not just a house, it's a promise." / "This isn't only about money; it's about pride." / "It wasn't about money. It
 * was about pride." / "The best part was never just the book. It was the talk." / "Rereading is a gift, not a waste." /
 * "They are not simple; they are clear."
 */
export const NOT_JUST = [
  /(?:\bnot|\bnever|n['’]t)\s+(?:just|only|merely|simply)\s+[^.!?;:,]{1,60}[,;:.]\s*(?:it|this|that|he|she|they|we|you)(?:['’](?:s|re)|\s+(?:is|was|are|were))\b/iu,
  /\b(?:it|this|that)(?:['’]s\s+not|\s+is\s+not|\s+was\s+not|\s+isn['’]t|\s+wasn['’]t)\s+[^.!?;:,]{1,50}[.,;:]\s*(?:it|this|that)(?:['’]s|\s+(?:is|was))\b/iu,
  /\b[\p{L}'’]+,\s+not\s+(?:(?:a|an|the)\s+)?[\p{L}'’-]+[.!;]/iu,
  /\bnot\s+[\p{L}'’]+;\s+(?:they|it|this|that|he|she|we)\s+(?:are|is|was|were)\s+[\p{L}'’]+/iu,
];

/** A sentence that closes its paragraph on a three-item list of one- or two-word items. */
export const CLOSING_TRIAD =
  /(?:^|[.!?]\s+)([^.!?]*?\b([\p{L}'’]+(?:\s[\p{L}'’]+)?),\s+([\p{L}'’]+(?:\s[\p{L}'’]+)?),?\s+(?:and|or)\s+([\p{L}'’]+(?:\s[\p{L}'’]+)?)[.!])\s*$/u;

/** An em dash anywhere, an en dash only with spaces round it (an unspaced one is a range: 2019–2024, pp. 12–14). */
export const DASH = /\s*—\s*|\s+–\s+|\s--\s/gu;

/**
 * Phrases current models still write, flagged in any text, each with what to do instead and the sign it maps to. Every
 * one was in the 2026-10-25 sample; a phrase that stops turning up in fresh output comes off.
 * @type {[string, string, string][]}
 */
export const TELLS = /* @__PURE__ */ (() => [
  // A companion's reply: the compliment, the reassurance before the answer, the offer after it.
  ["great question", "Answer the question. Cut the compliment.", SIGNS.collaborative],
  ["you're not wrong", "Cut the reassurance and give the answer.", SIGNS.collaborative],
  ["you're not missing anything", "Cut the reassurance and give the answer.", SIGNS.collaborative],
  [
    "would you like me to",
    "Stop when the answer is done. Offer more only when the reader needs it.",
    SIGNS.collaborative,
  ],
  ["here's the truth", "Delete it and say the claim.", SIGNS.collaborative],
  ["here is the truth", "Delete it and say the claim.", SIGNS.collaborative],
  // A book blurb's closing verdict.
  ["stays with you", "End on a fact about the book, or stop.", SIGNS.promotional],
  ["long after the last page", "End on a fact about the book, or stop.", SIGNS.promotional],
  ["impossible to put down", "End on a fact about the book, or stop.", SIGNS.promotional],
  [
    "remains one of the most",
    "Say what the book does. Its rank is the reader's to judge.",
    SIGNS.significance,
  ],
  // A newsletter.
  ["we're delighted", "Delete it and start with the news.", SIGNS.promotional],
  ["that's why we've built", "Say what it does.", SIGNS.promotional],
  ["that's why we built", "Say what it does.", SIGNS.promotional],
  ["here's what's new", "Name the one change that matters, in a sentence.", SIGNS.promotional],
  // A customer email's reflex permission and sincerity.
  ["no hard feelings", "Say what happens if they do nothing, and stop.", SIGNS.collaborative],
  ["that's completely fine", "Say what happens if they do nothing, and stop.", SIGNS.collaborative],
  ["that's okay too", "Say what happens if they do nothing, and stop.", SIGNS.collaborative],
])();

/**
 * Words current models reach for in a blurb, a bio or an email that most writers rarely use. `checkProse` flags them in
 * any text; `slopScan` only when the author's own excerpts never use them, since a word the author writes is theirs.
 */
export const OUT_OF_PLACE = [
  "unforgettable",
  "haunting",
  "lyrical",
  "sweeping",
  "poignant",
  "profound",
  "masterpiece",
  "quietly",
  "genuinely",
];

/** @import { PatternRule } from "./prose.mjs" */

/**
 * What a chatbot leaves in text, an error in any published text whoever wrote the rest, so all high: its refusal, its
 * note on its training, a blank it left to fill, its citation markup and tracking tags. Only wording no person writes
 * to a reader: "Let me know if" and "I hope this helps" end real letters, so they are not here. Matched per line,
 * outside code.
 * @type {PatternRule[]}
 */
export const PATTERNS = /* @__PURE__ */ (() => [
  // "As an AI language model researcher" and "I'm sorry, but I can't help thinking" are a person's words: the model
  // phrase must not run on into a noun, and the refusal must name the request it refuses.
  {
    check: "leftover",
    sign: SIGNS.refusal,
    severity: "high",
    re: /\bas (?:an AI language model|a large language model)\b(?![ \t]+(?!I\b)\p{L})|\bas an AI, I\b|\bI['’]m sorry, but I (?:can(?:not|['’]t)|am unable to) (?:(?:help|assist)(?: you)?|comply) with (?:(?:that|this|your|the) request\b|(?:that|this|it)(?=\s*(?:[.!,;:]|$)))/giu,
    say: "A chatbot's refusal. Delete it and write the text.",
  },
  {
    check: "leftover",
    sign: SIGNS.cutoff,
    severity: "high",
    re: /\b(?:as of|up to) my (?:last |latest )?(?:knowledge|training)(?: data)? (?:update|cut-?off)\b|\bmy knowledge cut-?off\b/giu,
    say: "A chatbot's note on its training. Delete it and check the fact.",
  },
  // Not a blank: a link (inline, reference, or `[label]` defined elsewhere in the text, which checkProse drops), a
  // `[[wiki]]` link, or bracketed text with a digit or a colon ("[Last updated: 2026-10-01]").
  {
    check: "placeholder",
    sign: SIGNS.placeholder,
    severity: "high",
    re: /(?<!\[)\[(?:your|insert|recipient|company|client|customer|first|last|full|product|date|name|link|url|phone|email|address)\b[^\]\n\d:]{0,30}\](?![([:\]])|\b(?:19|20)\d\d-XX-XX\b/giu,
    say: "A blank nobody filled in. Fill it or cut it.",
  },
  {
    check: "markup",
    sign: SIGNS.markup,
    severity: "high",
    re: /\boaicite\b|\bcontentReference\[|\bturn\d+(?:search|news|view|file)\d+\b|\butm_source=(?:chatgpt\.com|openai|copilot\.com)|\breferrer=grok\.com/giu,
    say: "A chatbot's citation markup or tracking tag. Remove it.",
  },
])();

/** Up to twenty characters either side of a match. @param {string} line @param {number} at @param {number} length */
export function around(line, at, length) {
  return line.slice(Math.max(0, at - 20), at + length + 20).trim();
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word, any-case match for a word or phrase, with either apostrophe. @param {string} phrase */
export function phraseRegExp(phrase) {
  return new RegExp(
    `(?<![\\p{L}'’])${escapeRegExp(phrase).replace(/'/g, "['’]")}(?![\\p{L}])`,
    "giu",
  );
}

/**
 * Every habit in `text`, each with the words it concerns, the line they are on and the sign in `SIGNS` it maps to.
 *
 * - `TELLS`, `OUT_OF_PLACE` and `PATTERNS` are high severity; `phrases` adds the caller's own (an author's list), also
 *   high. `allow` takes a word or phrase back out of every list and pattern.
 * - `dashes: "allow"` leaves em and en dashes alone, for an author whose own prose uses them; by default each line with
 *   one is flagged.
 * - `firstLine` is the file line `text` starts on, when it is a body cut from below a header.
 * - `model` is the model that wrote `text` (W4). `TELLS` and `OUT_OF_PLACE` were seen in Claude's output only, so for
 *   any model whose id does not start with `claude` (a Llama on Workers AI) they are left out, and what is left is what
 *   is wrong whoever wrote it: `PATTERNS`, the caller's phrases, and Wikipedia's general signs (the "not X, it's Y"
 *   construction, dashes, a closing list of three). A list for another model goes in only once it is seen in that
 *   model's own fresh output. Unset means Claude.
 *
 * @param {string} text
 * @param {{ phrases?: string[], allow?: string[], dashes?: "flag" | "allow", firstLine?: number, model?: string }} [options]
 * @returns {ProseIssue[]}
 */
export function checkProse(text, options = {}) {
  const { phrases = [], allow = [], dashes = "flag", firstLine = 1, model = "claude" } = options;
  const claude = /^claude/i.test(model);
  const allowed = new Set(allow.map((w) => w.toLowerCase()));
  const lines = text.split("\n");
  /** @type {ProseIssue[]} */
  const out = [];
  const seen = new Set();
  /** @param {ProseIssue} issue */
  const add = (issue) => {
    const key = `${issue.check}\u0000${(issue.excerpt ?? issue.message).toLowerCase()}\u0000${issue.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(issue);
  };

  /** @type {[string, string, string, string | null][]} */
  const listed = [
    ...(claude ? TELLS : []).map(
      ([p, say, sign]) => /** @type {[string, string, string, string]} */ (["tell", p, say, sign]),
    ),
    ...(claude ? OUT_OF_PLACE : []).map(
      (w) =>
        /** @type {[string, string, string, string]} */ ([
          "word",
          w,
          "Use the plain word, or cut it and keep the fact.",
          SIGNS.vocabulary,
        ]),
    ),
    ...phrases.map((p) => /** @type {[string, string, string, null]} */ (["phrase", p, "", null])),
  ];
  // Every occurrence counts, two on one line included.
  for (const [check, phrase, say, sign] of listed) {
    if (allowed.has(phrase.toLowerCase())) continue;
    const re = phraseRegExp(phrase);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const message =
          check === "phrase" ? `"${phrase}" is on the list of stock phrases.` : `"${m[0]}": ${say}`;
        out.push({ check, message, excerpt: m[0], line: firstLine + i, severity: "high", sign });
      }
    });
  }

  // The patterns read the lines outside fenced code, with inline code taken out. A `[label]` that the text defines as a
  // Markdown reference link is a link, not a blank.
  const defined = new Set(
    [...text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*\S/gmu)].map((m) => `[${m[1].toLowerCase()}]`),
  );
  let fenced = false;
  lines.forEach((line, i) => {
    const fence = /^\s*(?:```|~~~)/.test(line);
    if (fence) fenced = !fenced;
    if (fence || fenced) return;
    for (const { check, sign, severity, re, say } of PATTERNS) {
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(re)) {
        if (
          !allowed.has(m[0].toLowerCase()) &&
          !(check === "placeholder" && defined.has(m[0].toLowerCase()))
        )
          out.push({
            check,
            message: `"${m[0]}": ${say}`,
            excerpt: m[0],
            line: firstLine + i,
            severity,
            sign,
          });
      }
    }
  });

  lines.forEach((line, i) => {
    // The construction often spans a line break inside a paragraph ("This wasn't about money.\nIt was about pride.").
    const next = lines[i + 1]?.trim() ? ` ${lines[i + 1]}` : "";
    // Across the break only when the match starts on this line and runs into the next: one wholly on the next line is
    // that line's to report.
    const across = (/** @type {RegExp} */ re) => {
      const m = next ? re.exec(line + next) : null;
      return m && m.index < line.length && m.index + m[0].length > line.length ? m : null;
    };
    const m = NOT_JUST.map((re) => re.exec(line) ?? across(re)).find(Boolean);
    if (m)
      add({
        check: "not-x-but-y",
        message: `The "not X, it's Y" construction.`,
        excerpt: m[0],
        line: firstLine + i,
        severity: "medium",
        sign: SIGNS.parallelism,
      });
    if (dashes === "flag") {
      for (const d of line.matchAll(DASH)) {
        add({
          check: "dash",
          message: "A dash where a comma, a full stop or brackets would do.",
          excerpt: around(line, d.index ?? 0, d[0].length),
          line: firstLine + i,
          severity: "medium",
          sign: SIGNS.dash,
        });
      }
    }
  });

  // Paragraphs, with the line each one ends on.
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i].trim() === "") {
      const paragraph = lines.slice(start, i).join(" ").trim();
      const m = CLOSING_TRIAD.exec(paragraph);
      if (m && !paragraph.startsWith("#")) {
        add({
          check: "closing-triad",
          message:
            "The paragraph closes on a list of three: fine if there are three things, padding if it is there for rhythm.",
          excerpt: m[1].trim(),
          line: firstLine + Math.max(start, i - 1),
          severity: "low",
          sign: SIGNS.three,
        });
      }
      start = i + 1;
    }
  }
  return out.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
}

/**
 * What a model is told before it writes, in plain words, so the checks have less to find. The habits are the ones
 * current models were seen to write (above); the rest are what the checks cannot see. Callers add the author's own
 * excerpts and guide.
 */
export const WRITING_RULES = `Write the way the author's excerpts read, not the way a model usually writes.

- Say the thing. No run-up ("Here's the truth:", "Great question"), no reassurance before the answer, no closing summary, no moral at the end.
- No closing verdict on a thing's worth ("stays with you", "remains one of the most") and no blurb adjectives ("unforgettable", "haunting", "lyrical", "profound"). End on a fact, or stop.
- No "not X, it's Y", no "It isn't about X. It's about Y." and no "a gift, not a waste".
- Lists of three only when there are three things. Never end a paragraph on one for rhythm.
- No dashes as all-purpose joiners. Use a comma, a full stop or brackets.
- Contractions where the author uses them. Let each sentence run as long as its thought, as the excerpts' sentences do.
- No hedging stacks ("may potentially", "it could be argued"). Commit, or say what you don't know and why.
- Concrete over abstract: a number, a name, an example, a thing that happened. Cut a sentence that would fit any article on the subject. Every name and number comes from the author's writing or a source you list; a fact you can't point to comes out.
- Active voice. Name who did it: "we tested 393 samples", not "393 samples were tested". This holds even where the excerpts are passive.
- Don't open on a definition the reader already knows. Start with the case, the finding or the question.
- No one-line stinger to end a paragraph, and no "So", "And" or "But" opening a sentence for effect, unless the excerpts write that way.
- No sincerity markers ("genuinely", "honestly") and no reflex permission ("no hard feelings", "that's completely fine"). Say what happens next.
- End when the answer is done. No offer of more ("Would you like me to") and no question to the reader at the end.
- Bold, headings and questions to the reader only where the author's own writing uses them.`;
