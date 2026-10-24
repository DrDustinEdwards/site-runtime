/**
 * The one check on AI-written prose, and the one measure of an author's voice, for every app that has a model write text
 * a person will read: Carrel's drafts, Foxhound's emails. It flags; it never rewrites. What a flag means is the caller's
 * call: Carrel shows it to the author, Foxhound regenerates the email.
 *
 * - `checkProse` runs the avoid-ai-writing engine (prose-engine.mjs, a generated copy: see update-prose-engine.mjs) and
 *   adds what the engine does not see: the "not X, it's Y" construction across two sentences, a paragraph that closes on
 *   a list of three, the caller's own words and phrases, and each dash on the line it sits on. Words the caller allows
 *   are dropped from every source.
 * - `profileOf`, `distanceFrom` and `nearestPassages` measure a text against the author's own passages in the manner of
 *   Burrows' Delta (sentence length, punctuation, contractions and function-word rates). Statistics cannot say whose prose
 *   a text is, only that it reads unlike the passages; and the passages nearest the author's usual style are the
 *   examples a model writes from best (Wang et al., Findings of EMNLP 2025: examples beat a described style).
 *
 * Nothing here scores text against an AI detector or aims to pass one. The goal is prose a reader finds worth reading.
 */

import AIDetector from "./prose-engine.mjs";

/** @typedef {"critical" | "high" | "medium" | "low"} Severity */
/** @typedef {{ check: string, message: string, excerpt: string | null, line: number | null, severity: Severity }} ProseIssue */
/** @typedef {"general" | "technical" | "marketing" | "personal"} ProseContext */

// ---------- the habits

/** "It's not just a house, it's a promise." / "This isn't only about money; it's about pride." / "It wasn't about money. It was about pride." */
export const NOT_JUST = [
  /(?:\bnot|n['’]t)\s+(?:just|only|merely|simply)\s+[^.!?;:,]{1,60}[,;:.]\s*(?:it|this|that|he|she|they|we|you)(?:['’](?:s|re)|\s+(?:is|was|are|were))\b/iu,
  /\b(?:it|this|that)(?:['’]s\s+not|\s+is\s+not|\s+was\s+not|\s+isn['’]t|\s+wasn['’]t)\s+[^.!?;:,]{1,50}[.,;:]\s*(?:it|this|that)(?:['’]s|\s+(?:is|was))\b/iu,
];

/** A sentence that closes its paragraph on a three-item list of one- or two-word items. */
const CLOSING_TRIAD = /(?:^|[.!?]\s+)([^.!?]*?\b([\p{L}'’]+(?:\s[\p{L}'’]+)?),\s+([\p{L}'’]+(?:\s[\p{L}'’]+)?),?\s+(?:and|or)\s+([\p{L}'’]+(?:\s[\p{L}'’]+)?)[.!])\s*$/u;

const DASH = /\s*[—–]\s*|\s--\s/gu;

/**
 * Stock phrases of a model writing to a customer, which the engine's lists (built from articles and posts) miss. Pass
 * them as `phrases` when the text is an email.
 */
export const EMAIL_PHRASES = [
  "I hope this email finds you well",
  "I hope this message finds you well",
  "we understand that",
  "rest assured",
  "at your earliest convenience",
  "please don't hesitate to",
  "feel free to reach out",
  "thank you for your understanding",
];

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word, any-case match for a word or phrase, with either apostrophe. @param {string} phrase */
function phraseRegExp(phrase) {
  return new RegExp(`(?<![\\p{L}'’])${escapeRegExp(phrase).replace(/'/g, "['’]")}(?![\\p{L}])`, "giu");
}

/**
 * The line `excerpt` first appears on, counted from `firstLine`, or null when it is not in the text as written (the engine
 * reports some findings as a count, not a quotation).
 * @param {string[]} lines @param {number} firstLine @param {string} excerpt
 */
function lineOf(lines, firstLine, excerpt) {
  const re = phraseRegExp(excerpt);
  const i = lines.findIndex((l) => {
    re.lastIndex = 0;
    return re.test(l);
  });
  return i === -1 ? null : firstLine + i;
}

/**
 * Every habit in `text`, each with the words it concerns and the line they are on.
 *
 * - `context` tunes the engine's lists: "marketing" tolerates sales words, "technical" tolerates jargon. Default "general".
 * - `phrases` adds the caller's own words and phrases (an author's list, `EMAIL_PHRASES`); `allow` takes words back out,
 *   from the engine's lists as well as from `phrases`.
 * - `dashes: "allow"` leaves em and en dashes alone, for an author whose own prose uses them; by default each line with
 *   one is flagged.
 * - `firstLine` is the file line `text` starts on, when it is a body cut from below a header.
 *
 * @param {string} text
 * @param {{ context?: ProseContext, phrases?: string[], allow?: string[], dashes?: "flag" | "allow", firstLine?: number }} [options]
 * @returns {ProseIssue[]}
 */
export function checkProse(text, options = {}) {
  const { context = "general", phrases = [], allow = [], dashes = "flag", firstLine = 1 } = options;
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

  const result = AIDetector.analyzeText(text, { contextMode: context, sourceMode: "rendered-markdown" });
  for (const issue of result.issues) {
    // Each dash is reported on its own line below; the engine's is a count for the whole text.
    if (issue.type === "em-dash") continue;
    if (allowed.has(String(issue.text).toLowerCase())) continue;
    const label = AIDetector.TYPE_LABELS[issue.type] ?? issue.type;
    const quoted = lineOf(lines, firstLine, issue.text);
    add({
      check: issue.type,
      message: `${label}: "${issue.text}".${issue.suggestion ? ` Try: ${issue.suggestion}.` : ""}`,
      excerpt: quoted === null ? null : issue.text,
      line: quoted,
      severity: issue.severity,
    });
  }

  for (const phrase of phrases) {
    if (allowed.has(phrase.toLowerCase())) continue;
    const re = phraseRegExp(phrase);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        add({ check: "phrase", message: `"${phrase}" is on your list of stock phrases.`, excerpt: m[0], line: firstLine + i, severity: "high" });
      }
    });
  }

  lines.forEach((line, i) => {
    const m = NOT_JUST.map((re) => re.exec(line)).find(Boolean);
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
        add({ check: "closing-triad", message: "The paragraph closes on a list of three.", excerpt: m[1].trim(), line: firstLine + Math.max(start, i - 1), severity: "medium" });
      }
      start = i + 1;
    }
  }
  return out.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
}

/**
 * What a model is told before it writes, in plain words, so the checks have less to find. The habits are the ones
 * `checkProse` flags; the rest are what the checks cannot see. Callers add the author's own excerpts and guide.
 */
export const WRITING_RULES = `Write the way the author's excerpts read, not the way a model usually writes.

- Say the thing. No run-up ("Here's the thing", "Let's be honest"), no closing summary, no moral at the end.
- Plain words over impressive ones: "use" not "leverage", "shows" not "is a testament to". No delve, tapestry, landscape, realm, navigate (unless literal), crucial, pivotal, seamless, robust.
- No "not X, it's Y", and no "It isn't about X. It's about Y."
- Lists of three only when there are three things. Never end a paragraph on one for rhythm.
- No dashes as all-purpose joiners. Use a comma, a full stop or brackets.
- Contractions where the author uses them. Vary sentence length the way the excerpts do; short sentences are fine, a run of them is a tic.
- No hedging stacks ("may potentially", "it could be argued"). Commit, or say what you don't know and why.
- Concrete over abstract: a number, a name, an example, a thing that happened. Cut a sentence that would fit any article on the subject.
- No inflated significance ("plays a vital role", "stands as", "marks a pivotal moment") and no vague authority ("experts say", "studies show") without the source.
- No chatbot leftovers: "I hope this helps", "Great question", "As an AI", "Certainly!".
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
/** @typedef {{ mean: Features, spread: Features, chunks: number, words: number }} Profile */
/** @typedef {{ name: string, value: number, mean: number, z: number }} FeatureReading */
/** @typedef {{ distance: number, furthest: FeatureReading[] }} VoiceReading */

/** @param {string} text */
function words(text) {
  return text.toLowerCase().match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) ?? [];
}

/** @param {string} text */
function sentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])["”’)]?\s+(?=["“‘(]?[\p{Lu}\d])/u)
    .map((s) => s.trim())
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
    contractions: per1000(all.filter((w) => /['’](?:s|t|re|ve|ll|d|m)$/.test(w)).length, total),
  };
  for (const fw of FUNCTION_WORDS) out[`"${fw}"`] = per1000(counts.get(fw) ?? 0, total);
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
  for (const p of paragraphs) {
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
  return { mean, spread, chunks: pieces.length, words: passages.reduce((n, p) => n + words(p).length, 0) };
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
  return passages
    .flatMap(chunks)
    .map((text) => ({ text, reading: distanceFrom(profile, text) }))
    .filter((c) => c.reading !== null)
    .sort((a, b) => /** @type {VoiceReading} */ (a.reading).distance - /** @type {VoiceReading} */ (b.reading).distance)
    .slice(0, count)
    .map((c) => c.text);
}

/**
 * Where a text counts as reading unlike the passages. Set between the fixtures in test/prose.test.mjs (measured
 * 2026-10-24: the passages themselves 0.46 to 0.54, the same register not in them 0.78, a public-domain passage by
 * Henry James 1.47). An app recalibrates once it holds the author's own text: the fixtures stand in for it.
 */
export const VOICE_THRESHOLD = 1.1;

/** One feature reading in words, for a flag. @param {FeatureReading} f */
export function describeFeature(f) {
  const round = (/** @type {number} */ n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  if (f.name === "sentence length") return `sentences average ${round(f.value)} words against ${round(f.mean)} in your passages`;
  return `${round(f.value)} ${f.name} per 1,000 words against ${round(f.mean)}`;
}
