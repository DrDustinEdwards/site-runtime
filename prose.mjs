/**
 * The one check on AI-written prose, and the one measure of an author's voice, for every app that has a model write text
 * a person will read: Carrel's drafts, Foxhound's emails. It flags; it never rewrites. What a flag means is the caller's
 * call: Carrel shows it to the author, Foxhound regenerates the email.
 *
 * The habits it looks for are the ones current Claude models were seen to write on 2026-10-25, with no style rules, across
 * book blurbs, bios, a companion's replies, UI copy, newsletters, journal posts, failed-payment and win-back emails, a
 * dispute statement and dashboard summaries (Capsid foxing/ai-writing-tells.md). The older lists ("delve", "tapestry",
 * "I hope this email finds you well", the em dash) are gone: those models no longer write them.
 *
 * - `checkProse` flags `TELLS`, the words in `OUT_OF_PLACE`, the "not X, it's Y" construction across two sentences, a
 *   paragraph that closes on a list of three, the caller's own words and phrases, and each dash on the line it sits on.
 *   Words the caller allows are dropped from every source.
 * - `profileOf`, `distanceFrom` and `nearestPassages` measure a text against the author's own passages in the manner of
 *   Burrows' Delta (sentence length, punctuation, contractions and function-word rates). Statistics cannot say whose prose
 *   a text is, only that it reads unlike the passages; and the passages nearest the author's usual style are the
 *   examples a model writes from best (Wang et al., Findings of EMNLP 2025: examples beat a described style).
 * - `slopScan` is the scan after a draft: spans that read unlike the author's excerpts (sentence length against their own
 *   spread, `TELLS`, the `OUT_OF_PLACE` words the excerpts never use, joiner dashes), each with what to do, and one
 *   instruction a session can apply.
 * - `voiceExcerpts` picks the excerpts a model writes from: one long sentence and one short one among them, not the
 *   passages nearest the average.
 *
 * Nothing here scores text against an AI detector or aims to pass one. The goal is prose a reader finds worth reading.
 */

/** @typedef {"critical" | "high" | "medium" | "low"} Severity */
/** @typedef {{ check: string, message: string, excerpt: string | null, line: number | null, severity: Severity }} ProseIssue */

// ---------- the habits

/** "It's not just a house, it's a promise." / "This isn't only about money; it's about pride." / "It wasn't about money. It was about pride." */
export const NOT_JUST = [
  /(?:\bnot|n['’]t)\s+(?:just|only|merely|simply)\s+[^.!?;:,]{1,60}[,;:.]\s*(?:it|this|that|he|she|they|we|you)(?:['’](?:s|re)|\s+(?:is|was|are|were))\b/iu,
  /\b(?:it|this|that)(?:['’]s\s+not|\s+is\s+not|\s+was\s+not|\s+isn['’]t|\s+wasn['’]t)\s+[^.!?;:,]{1,50}[.,;:]\s*(?:it|this|that)(?:['’]s|\s+(?:is|was))\b/iu,
];

/** A sentence that closes its paragraph on a three-item list of one- or two-word items. */
const CLOSING_TRIAD = /(?:^|[.!?]\s+)([^.!?]*?\b([\p{L}'’]+(?:\s[\p{L}'’]+)?),\s+([\p{L}'’]+(?:\s[\p{L}'’]+)?),?\s+(?:and|or)\s+([\p{L}'’]+(?:\s[\p{L}'’]+)?)[.!])\s*$/u;

/** An em dash anywhere, an en dash only with spaces round it (an unspaced one is a range: 2019–2024, pp. 12–14). */
const DASH = /\s*—\s*|\s+–\s+|\s--\s/gu;

/**
 * Phrases current models still write, flagged in any text, each with what to do instead. Every one was in the 2026-10-25
 * sample; a phrase that stops turning up in fresh output comes off.
 * @type {[string, string][]}
 */
export const TELLS = [
  // A companion's reply: the compliment, the reassurance before the answer, the offer after it.
  ["great question", "Answer the question. Cut the compliment."],
  ["you're not wrong", "Cut the reassurance and give the answer."],
  ["you're not missing anything", "Cut the reassurance and give the answer."],
  ["would you like me to", "Stop when the answer is done. Offer more only when the reader needs it."],
  ["here's the truth", "Delete it and say the claim."],
  ["here is the truth", "Delete it and say the claim."],
  // A book blurb's closing verdict.
  ["stays with you", "End on a fact about the book, or stop."],
  ["long after the last page", "End on a fact about the book, or stop."],
  ["impossible to put down", "End on a fact about the book, or stop."],
  ["remains one of the most", "Say what the book does. Its rank is the reader's to judge."],
  // A newsletter.
  ["we're delighted", "Delete it and start with the news."],
  ["that's why we've built", "Say what it does."],
  ["that's why we built", "Say what it does."],
  ["here's what's new", "Name the one change that matters, in a sentence."],
  // A customer email's reflex permission and sincerity.
  ["no hard feelings", "Say what happens if they do nothing, and stop."],
  ["that's completely fine", "Say what happens if they do nothing, and stop."],
  ["that's okay too", "Say what happens if they do nothing, and stop."],
];

/**
 * Words current models reach for in a blurb, a bio or an email that most writers rarely use. `checkProse` flags them in
 * any text; `slopScan` only when the author's own excerpts never use them, since a word the author writes is theirs.
 */
export const OUT_OF_PLACE = ["unforgettable", "haunting", "lyrical", "sweeping", "poignant", "profound", "masterpiece", "quietly", "genuinely"];

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word, any-case match for a word or phrase, with either apostrophe. @param {string} phrase */
function phraseRegExp(phrase) {
  return new RegExp(`(?<![\\p{L}'’])${escapeRegExp(phrase).replace(/'/g, "['’]")}(?![\\p{L}])`, "giu");
}

/**
 * Every habit in `text`, each with the words it concerns and the line they are on.
 *
 * - `TELLS` and `OUT_OF_PLACE` are high severity; `phrases` adds the caller's own (an author's list), also high. `allow`
 *   takes a word or phrase back out of every list.
 * - `dashes: "allow"` leaves em and en dashes alone, for an author whose own prose uses them; by default each line with
 *   one is flagged.
 * - `firstLine` is the file line `text` starts on, when it is a body cut from below a header.
 *
 * @param {string} text
 * @param {{ phrases?: string[], allow?: string[], dashes?: "flag" | "allow", firstLine?: number }} [options]
 * @returns {ProseIssue[]}
 */
export function checkProse(text, options = {}) {
  const { phrases = [], allow = [], dashes = "flag", firstLine = 1 } = options;
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

  /** @type {[string, string, string][]} */
  const listed = [
    ...TELLS.map(([p, say]) => /** @type {[string, string, string]} */ (["tell", p, say])),
    ...OUT_OF_PLACE.map((w) => /** @type {[string, string, string]} */ (["word", w, "Use the plain word, or cut it and keep the fact."])),
    ...phrases.map((p) => /** @type {[string, string, string]} */ (["phrase", p, ""])),
  ];
  // Every occurrence counts, two on one line included.
  for (const [check, phrase, say] of listed) {
    if (allowed.has(phrase.toLowerCase())) continue;
    const re = phraseRegExp(phrase);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const message = check === "phrase" ? `"${phrase}" is on the list of stock phrases.` : `"${m[0]}": ${say}`;
        out.push({ check, message, excerpt: m[0], line: firstLine + i, severity: "high" });
      }
    });
  }

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
    if (m) add({ check: "not-x-but-y", message: `The "not X, it's Y" construction.`, excerpt: m[0], line: firstLine + i, severity: "medium" });
    if (dashes === "flag") {
      for (const d of line.matchAll(DASH)) {
        const at = d.index ?? 0;
        const excerpt = line.slice(Math.max(0, at - 20), at + d[0].length + 20).trim();
        add({ check: "dash", message: "A dash where a comma, a full stop or brackets would do.", excerpt, line: firstLine + i, severity: "medium" });
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
        add({ check: "closing-triad", message: "The paragraph closes on a list of three: fine if there are three things, padding if it is there for rhythm.", excerpt: m[1].trim(), line: firstLine + Math.max(start, i - 1), severity: "low" });
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
- No "not X, it's Y", and no "It isn't about X. It's about Y."
- Lists of three only when there are three things. Never end a paragraph on one for rhythm.
- No dashes as all-purpose joiners. Use a comma, a full stop or brackets.
- Contractions where the author uses them. Let each sentence run as long as its thought, as the excerpts' sentences do.
- No hedging stacks ("may potentially", "it could be argued"). Commit, or say what you don't know and why.
- Concrete over abstract: a number, a name, an example, a thing that happened. Cut a sentence that would fit any article on the subject.
- No sincerity markers ("genuinely", "honestly") and no reflex permission ("no hard feelings", "that's completely fine"). Say what happens next.
- End when the answer is done. No offer of more ("Would you like me to") unless the reader needs it.
- Bold and headings only where the author's own posts use them.`;

// ---------- the voice

const FUNCTION_WORDS = [
  "the", "and", "of", "to", "a", "in", "that", "it", "was", "he", "she", "i", "you", "with", "for", "on", "as",
  "at", "but", "had", "his", "her", "not", "be", "is", "they", "by", "from", "this", "so", "all", "were", "there",
  "which", "would", "when", "then", "what", "if", "into", "out", "up", "like", "just", "some", "no", "one", "or",
];

/** How long a text needs to be before its profile means anything. */
const MIN_WORDS = 250;
/** The chunk size passages are cut into, so their spread can be measured. */
const CHUNK_WORDS = 300;
/** The most one feature can add to the distance, in standard deviations. */
const MAX_Z = 5;
/** A floor on sentence length's spread, relative to its mean, so passages that agree closely cannot make it dominate. */
const MIN_SPREAD = 0.15;

/** @typedef {Record<string, number>} Features */
/** @typedef {{ mean: Features, spread: Features, chunks: number, words: number, usual?: number }} Profile */
/** @typedef {{ name: string, value: number, mean: number, z: number }} FeatureReading */
/** @typedef {{ distance: number, furthest: FeatureReading[] }} VoiceReading */

const CONTRACTION = /(?:n['’]t|['’](?:re|ve|ll|d|m)|^(?:it|that|there|here|what|who|where|how|he|she|let)['’]s)$/u;

/** @param {string} text */
function words(text) {
  return text.toLowerCase().match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) ?? [];
}

/** Abbreviations whose full stop does not end a sentence ("Dr. Edwards", "Fig. 1", "U.S. policy"). */
const ABBREVIATIONS = /\bNo\.(?=\s*\d)|\b(?:Dr|Mr|Mrs|Ms|Prof|St|Jr|Sr|Fig|Figs|Vol|pp|vs|al|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m)\./gu;

/** @param {string} text */
function sentences(text) {
  return text
    .replace(ABBREVIATIONS, (m) => m.replace(/\./g, "\u2024"))
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])["”’)]?\s+(?=["“‘(]?[\p{Lu}\d])/u)
    .map((s) => s.replace(/\u2024/g, ".").trim())
    .filter((s) => words(s).length > 0);
}

/** @param {number} count @param {number} total */
function per1000(count, total) {
  return total === 0 ? 0 : (count * 1000) / total;
}

/** @param {string} text @returns {Features} */
function features(text) {
  const all = words(text);
  const total = all.length;
  const sents = sentences(text);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const w of all) counts.set(w, (counts.get(w) ?? 0) + 1);
  const count = (/** @type {RegExp} */ re) => text.match(re)?.length ?? 0;

  /** @type {Features} */
  const out = {
    "sentence length": sents.length === 0 ? 0 : total / sents.length,
    commas: per1000(count(/,/g), total),
    semicolons: per1000(count(/;/g), total),
    colons: per1000(count(/:/g), total),
    dashes: per1000(count(/—|–|--/g), total),
    questions: per1000(count(/\?/g), total),
    exclamations: per1000(count(/!/g), total),
    // People editing a model's draft toward their own voice added contractions above all (Baumler et al., ACL 2026).
    // A possessive is not a contraction ("Edwards's", "the phage's"): 's counts only after a pronoun or "let".
    contractions: per1000(all.filter((w) => CONTRACTION.test(w)).length, total),
  };
  for (const fw of FUNCTION_WORDS) out[`"${fw}"`] = per1000(counts.get(fw) ?? 0, total);
  return out;
}

/** Sentences regrouped into runs of about CHUNK_WORDS words. @param {string[]} sents */
function runsOf(sents) {
  /** @type {string[]} */
  const out = [];
  let run = "";
  for (const sent of sents) {
    run = run ? `${run} ${sent}` : sent;
    if (words(run).length >= CHUNK_WORDS) {
      out.push(run);
      run = "";
    }
  }
  if (run) out.push(run);
  return out;
}

/** Cuts text into runs of about CHUNK_WORDS words, on paragraph boundaries where it can. @param {string} text */
function chunks(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let current = [];
  let size = 0;
  // A post with no paragraph breaks would otherwise come back whole: cut such a paragraph on sentences.
  const pieces = paragraphs.flatMap((p) => (words(p).length > 2 * CHUNK_WORDS ? runsOf(sentences(p)) : [p]));
  for (const p of pieces) {
    current.push(p);
    size += words(p).length;
    if (size >= CHUNK_WORDS) {
      out.push(current.join("\n\n"));
      current = [];
      size = 0;
    }
  }
  if (size >= CHUNK_WORDS / 2) out.push(current.join("\n\n"));
  return out;
}

/**
 * The profile of the author's passages, or null when there is too little of their text to compare with.
 * @param {string[]} passages
 * @returns {Profile | null}
 */
export function profileOf(passages) {
  const pieces = passages.flatMap(chunks);
  if (pieces.length < 3) return null;
  const rows = pieces.map(features);
  const names = Object.keys(rows[0]);
  /** @type {Features} */
  const mean = {};
  /** @type {Features} */
  const spread = {};
  for (const name of names) {
    const values = rows.map((r) => r[name] ?? 0);
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
    mean[name] = m;
    // A spread of zero would make any difference infinitely far. A rate cannot be measured finer than one occurrence
    // in a chunk, so that is its floor; sentence length gets a relative one.
    const floor = name === "sentence length" ? MIN_SPREAD * Math.max(1, m) : 1000 / CHUNK_WORDS;
    spread[name] = Math.max(Math.sqrt(variance), floor);
  }
  // How far the author's own chunks sit from their mean: the 90th percentile is the edge of their usual range.
  const own = rows.map((f) => deltaOf(mean, spread, f)).sort((a, b) => a - b);
  const usual = own[Math.min(own.length - 1, Math.floor(own.length * 0.9))];
  return { mean, spread, chunks: pieces.length, words: passages.reduce((n, p) => n + words(p).length, 0), usual };
}

/** The mean capped distance, in standard deviations, of one feature set from a profile's. @param {Features} mean @param {Features} spread @param {Features} f */
function deltaOf(mean, spread, f) {
  const names = Object.keys(mean);
  return names.reduce((a, name) => a + Math.min(MAX_Z, Math.abs(((f[name] ?? 0) - (mean[name] ?? 0)) / (spread[name] ?? 1))), 0) / names.length;
}

/**
 * Where a text starts to read unlike this author: the edge of their own range (a profile's `usual`), and never closer
 * than VOICE_THRESHOLD. An author who writes both lab notes and essays has a wide range, so a methods note is not
 * flagged against the mix.
 * @param {Profile} profile
 */
export function thresholdFor(profile) {
  return Math.max(VOICE_THRESHOLD, profile.usual ?? 0);
}

/**
 * How far `text` reads from the profile (the mean of each feature's distance in standard deviations, each capped at
 * MAX_Z so one habit cannot outweigh the rest), with the three furthest features; null when `text` is too short.
 * @param {Profile} profile
 * @param {string} text
 * @returns {VoiceReading | null}
 */
export function distanceFrom(profile, text) {
  if (words(text).length < MIN_WORDS) return null;
  const f = features(text);
  const scored = Object.keys(profile.mean).map((name) => {
    const value = f[name] ?? 0;
    const mean = profile.mean[name] ?? 0;
    return { name, value, mean, z: (value - mean) / (profile.spread[name] ?? 1) };
  });
  const distance = scored.reduce((a, s) => a + Math.min(MAX_Z, Math.abs(s.z)), 0) / scored.length;
  const furthest = [...scored].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 3);
  return { distance, furthest };
}

/**
 * The `count` excerpts (about 300 words each, cut on paragraph boundaries) that read most like the author's usual
 * style: the examples to hand a model before it writes.
 * @param {Profile} profile
 * @param {string[]} passages
 * @param {number} [count]
 * @returns {string[]}
 */
export function nearestPassages(profile, passages, count = 5) {
  // The nearest chunk of each passage, so the examples come from different pieces rather than one long post.
  return passages
    .map((passage) =>
      chunks(passage)
        .map((text) => ({ text, distance: distanceFrom(profile, text)?.distance ?? Infinity }))
        .sort((a, b) => a.distance - b.distance)[0],
    )
    .filter((c) => c !== undefined && Number.isFinite(c.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((c) => c.text);
}

/**
 * The least distance at which a text counts as reading unlike the passages (thresholdFor widens it to the author's own
 * range). Set between the fixtures in test/prose.test.mjs (measured
 * 2026-10-24: the passages themselves 0.46 to 0.54, the same register not in them 0.78, a public-domain passage by
 * Henry James 1.47). An app recalibrates once it holds the author's own text: the fixtures stand in for it.
 */
export const VOICE_THRESHOLD = 1.1;

/**
 * Runs of at least `minWords` words that `text` repeats word for word from one of `sources`: an example the model was
 * told to write like, copied instead. Each run is reported once, longest match first.
 * @param {string} text
 * @param {string[]} sources
 * @param {number} [minWords]
 * @returns {string[]}
 */
export function copiedRuns(text, sources, minWords = 8) {
  const key = (/** @type {string[]} */ ws) => ws.join(" ");
  /** @type {Set<string>} */
  const seen = new Set();
  for (const source of sources) {
    const ws = words(source);
    for (let i = 0; i + minWords <= ws.length; i++) seen.add(key(ws.slice(i, i + minWords)));
  }
  const ws = words(text);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + minWords <= ws.length; ) {
    if (!seen.has(key(ws.slice(i, i + minWords)))) {
      i++;
      continue;
    }
    let end = i + minWords;
    while (end < ws.length && seen.has(key(ws.slice(end - minWords + 1, end + 1)))) end++;
    out.push(key(ws.slice(i, end)));
    i = end;
  }
  return out;
}

/** One feature reading in words, for a flag. @param {FeatureReading} f */
export function describeFeature(f) {
  const round = (/** @type {number} */ n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  if (f.name === "sentence length") return `sentences average ${round(f.value)} words against ${round(f.mean)} in your passages`;
  return `${round(f.value)} ${f.name} per 1,000 words against ${round(f.mean)}`;
}

// ---------- the scan

/** The most findings one scan returns: past a dozen, a session rewrites instead of editing. */
const MAX_FINDINGS = 12;
/** Excerpt sentences shorter than this are left out of the spread ("Dr." and "Fig." cut by the splitter, "Yes."). */
const SPREAD_MIN_WORDS = 4;

/** @typedef {"length" | "filler" | "word" | "shape"} SlopKind */
/** @typedef {{ kind: SlopKind, excerpt: string, line: number, say: string }} SlopFinding */
/** @typedef {{ short: number, mid: number, long: number, longest: number }} Spread */

/** @param {number[]} sorted @param {number} p */
function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/** Markdown reduced to the words a reader reads: link text kept, marks and code dropped. @param {string} line */
function readable(line) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(?:>\s?|[-*+]\s+|\d+\.\s+)/, "")
    .replace(/(\*\*|__|\*|_)(?=\S)([^*_]+?)\1/g, "$2");
}

/** The prose lines of a text with their line numbers: headings, code, tables and HTML blocks left out. @param {string} text @param {number} firstLine */
function proseLines(text, firstLine) {
  /** @type {{ text: string, line: number }[]} */
  const out = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced || /^\s*(?:#|\||<|---\s*$)/.test(raw)) return;
    out.push({ text: readable(raw), line: firstLine + i });
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
  return { short: percentile(lengths, 0.1), mid: percentile(lengths, 0.5), long: percentile(lengths, 0.9), longest: lengths[lengths.length - 1] };
}

/** A sentence quoted short enough for a list line. @param {string} s */
function quote(s) {
  const ws = s.trim().split(/\s+/);
  return ws.length > 12 ? `${ws.slice(0, 10).join(" ")} …` : s.trim();
}

/** Joiner dashes per 1,000 words of the excerpts: an author who writes a dash a page keeps theirs. @param {string} text */
function dashRate(text) {
  return per1000(text.match(DASH)?.length ?? 0, words(text).length);
}

/**
 * The scan after a draft: what in it reads unlike the author's excerpts, as spans a session can fix in place. No model
 * and no detector. Four kinds:
 * - `length`: a sentence well past the author's long ones, or four or more in a row of the same length when the author's
 *   own vary (measured from the excerpts; skipped under five excerpt sentences of four words or more);
 * - `filler`: a phrase in `TELLS`;
 * - `word`: a short closed list of a model's words (OUT_OF_PLACE), each only when the excerpts never use it;
 * - `shape`: a dash used as a joiner, "not X, it's Y", and a paragraph ending on three padded words, each only when the
 *   excerpts do not write that way themselves. A dash between numbers is a range and passes.
 * At most twelve findings, in line order. `instruction` is what to hand the session that wrote the draft, null when there
 * is nothing to fix. `firstLine` is the file line `text` starts on.
 * @param {string} text
 * @param {string[]} excerpts
 * @param {{ firstLine?: number }} [options]
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
    const sents = lines.flatMap((l) => sentences(l.text).map((s) => ({ s, n: words(s).length, line: l.line })));
    // Past the excerpts' long sentences by eight words, and past their longest: a length the author writes is theirs.
    const limit = Math.max(spread.long + 7, spread.longest);
    for (const { s, n, line } of sents) {
      if (n > limit) {
        found.push({ kind: "length", excerpt: quote(s), line, say: `This is ${n} words. The long sentences in the excerpts are about ${spread.long}. Split it where the subject changes.` });
      }
    }
    if (spread.long - spread.short >= 10) {
      for (let i = 0; i + 4 <= sents.length; ) {
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
    for (const word of outOfPlace) {
      for (const m of line.matchAll(phraseRegExp(word))) {
        const at = m.index ?? 0;
        if (filled.some(([a, b]) => at >= a && at < b)) continue;
        found.push({ kind: "word", excerpt: m[0], line: n, say: "This word is not in the excerpts. Use the plain word the excerpts would use, or cut it and keep the fact." });
      }
    }
    if (!dashesAreTheirs) {
      for (const m of line.matchAll(DASH)) {
        // Between two numbers it is a range (2019—2024), not a joiner.
        if (/\d$/.test(line.slice(0, m.index ?? 0)) && /^\d/.test(line.slice((m.index ?? 0) + m[0].length))) continue;
        const around = line.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + m[0].length + 20).trim();
        found.push({ kind: "shape", excerpt: around, line: n, say: "Make this two sentences, or a comma if it is one thought." });
      }
    }
    if (!notXIsTheirs) {
      const next = lines[i + 1]?.text.trim() ? ` ${lines[i + 1].text}` : "";
      const hit = NOT_JUST.map((re) => {
        const own = re.exec(line);
        if (own) return own;
        const m = next ? re.exec(line + next) : null;
        return m && (m.index ?? 0) < line.length && (m.index ?? 0) + m[0].length > line.length ? m : null;
      }).find(Boolean);
      if (hit) found.push({ kind: "shape", excerpt: hit[0].trim(), line: n, say: 'Say what it is. "Not X, it\'s Y" sets up a claim nobody made.' });
    }
    // A paragraph's last line: the next line is blank or there is none.
    const last = !lines[i + 1] || !lines[i + 1].text.trim() || lines[i + 1].line !== n + 1;
    const triad = last ? CLOSING_TRIAD.exec(line.trim()) : null;
    if (triad) {
      const padded = [triad[2], triad[3], triad[4]].filter((item) => words(item).some((w) => outOfPlace.includes(w))).length;
      if (padded >= 2) {
        // The list's own words are this finding's to fix, not three more.
        for (let k = found.length - 1; k >= 0; k--) {
          if (found[k].kind === "word" && found[k].line === n && triad[1].toLowerCase().includes(found[k].excerpt.toLowerCase())) found.splice(k, 1);
        }
        found.push({ kind: "shape", excerpt: triad[1].trim(), line: n, say: "This list is padding. End on the fact. Keep a list of three only when the three things are real." });
      }
    }
  });

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
    ...(spread ? [`The excerpts' sentences run about ${spread.short}, ${spread.mid}, and ${spread.long} words. Stay inside that spread. Do not alternate short and long on purpose.`] : []),
  ];
  return [...head, ...findings.map((f) => `- ${f.line === null ? "" : `Line ${f.line}, `}"${f.excerpt}": ${f.say}`)].join("\n");
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
