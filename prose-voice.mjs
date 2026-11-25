/**
 * The measure of an author's voice (see prose.mjs for how the check and the scan use it): rates of sentence length,
 * punctuation, contractions and function words over the author's passages, and a text's distance from them in the
 * manner of Burrows' Delta. ./prose re-exports what a caller imports.
 */

const FUNCTION_WORDS = [
  "the",
  "and",
  "of",
  "to",
  "a",
  "in",
  "that",
  "it",
  "was",
  "he",
  "she",
  "i",
  "you",
  "with",
  "for",
  "on",
  "as",
  "at",
  "but",
  "had",
  "his",
  "her",
  "not",
  "be",
  "is",
  "they",
  "by",
  "from",
  "this",
  "so",
  "all",
  "were",
  "there",
  "which",
  "would",
  "when",
  "then",
  "what",
  "if",
  "into",
  "out",
  "up",
  "like",
  "just",
  "some",
  "no",
  "one",
  "or",
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

const CONTRACTION =
  /(?:n['’]t|['’](?:re|ve|ll|d|m)|^(?:it|that|there|here|what|who|where|how|he|she|let)['’]s)$/u;

/** @param {string} text */
export function words(text) {
  return text.toLowerCase().match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) ?? [];
}

/** Abbreviations whose full stop does not end a sentence ("Dr. Rivera", "Fig. 1", "U.S. policy"). */
const ABBREVIATIONS =
  /\bNo\.(?=\s*\d)|\b(?:Dr|Mr|Mrs|Ms|Prof|St|Jr|Sr|Fig|Figs|Vol|pp|vs|al|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m)\./gu;

/** @param {string} text */
export function sentences(text) {
  return text
    .replace(ABBREVIATIONS, (m) => m.replace(/\./g, "\u2024"))
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])["”’)]?\s+(?=["“‘(]?[\p{Lu}\d])/u)
    .map((s) => s.replace(/\u2024/g, ".").trim())
    .filter((s) => words(s).length > 0);
}

/** @param {number} count @param {number} total */
export function per1000(count, total) {
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
    // A possessive is not a contraction ("Rivera's", "the river's"): 's counts only after a pronoun or "let".
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
export function chunks(text) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let current = [];
  let size = 0;
  // A post with no paragraph breaks would otherwise come back whole: cut such a paragraph on sentences.
  const pieces = paragraphs.flatMap((p) =>
    words(p).length > 2 * CHUNK_WORDS ? runsOf(sentences(p)) : [p],
  );
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
  return {
    mean,
    spread,
    chunks: pieces.length,
    words: passages.reduce((n, p) => n + words(p).length, 0),
    usual,
  };
}

/** The mean capped distance, in standard deviations, of one feature set from a profile's. @param {Features} mean @param {Features} spread @param {Features} f */
function deltaOf(mean, spread, f) {
  const names = Object.keys(mean);
  return (
    names.reduce(
      (a, name) =>
        a + Math.min(MAX_Z, Math.abs(((f[name] ?? 0) - (mean[name] ?? 0)) / (spread[name] ?? 1))),
      0,
    ) / names.length
  );
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
    .map(
      (passage) =>
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
  for (let i = 0; i + minWords <= ws.length;) {
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
  if (f.name === "sentence length")
    return `sentences average ${round(f.value)} words against ${round(f.mean)} in your passages`;
  return `${round(f.value)} ${f.name} per 1,000 words against ${round(f.mean)}`;
}

/** @param {number[]} sorted @param {number} p */
export function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}
