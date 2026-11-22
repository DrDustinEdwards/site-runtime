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
export function checkProse(text: string, options?: {
    phrases?: string[];
    allow?: string[];
    dashes?: "flag" | "allow";
    firstLine?: number;
    model?: string;
}): ProseIssue[];
/**
 * The profile of the author's passages, or null when there is too little of their text to compare with.
 * @param {string[]} passages
 * @returns {Profile | null}
 */
export function profileOf(passages: string[]): Profile | null;
/**
 * Where a text starts to read unlike this author: the edge of their own range (a profile's `usual`), and never closer
 * than VOICE_THRESHOLD. An author who writes both lab notes and essays has a wide range, so a methods note is not
 * flagged against the mix.
 * @param {Profile} profile
 */
export function thresholdFor(profile: Profile): number;
/**
 * How far `text` reads from the profile (the mean of each feature's distance in standard deviations, each capped at
 * MAX_Z so one habit cannot outweigh the rest), with the three furthest features; null when `text` is too short.
 * @param {Profile} profile
 * @param {string} text
 * @returns {VoiceReading | null}
 */
export function distanceFrom(profile: Profile, text: string): VoiceReading | null;
/**
 * The `count` excerpts (about 300 words each, cut on paragraph boundaries) that read most like the author's usual
 * style: the examples to hand a model before it writes.
 * @param {Profile} profile
 * @param {string[]} passages
 * @param {number} [count]
 * @returns {string[]}
 */
export function nearestPassages(profile: Profile, passages: string[], count?: number): string[];
/**
 * Runs of at least `minWords` words that `text` repeats word for word from one of `sources`: an example the model was
 * told to write like, copied instead. Each run is reported once, longest match first.
 * @param {string} text
 * @param {string[]} sources
 * @param {number} [minWords]
 * @returns {string[]}
 */
export function copiedRuns(text: string, sources: string[], minWords?: number): string[];
/** One feature reading in words, for a flag. @param {FeatureReading} f */
export function describeFeature(f: FeatureReading): string;
/**
 * How long the author's sentences run, from their excerpts: the 10th percentile, the median and the 90th, over sentences
 * of four words or more. Null under five such sentences.
 * @param {string[]} excerpts
 * @returns {Spread | null}
 */
export function sentenceSpread(excerpts: string[]): Spread | null;
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
export function slopScan(text: string, excerpts: string[], options?: {
    firstLine?: number;
    sources?: string[];
}): {
    findings: SlopFinding[];
    instruction: string | null;
    spread: Spread | null;
};
/**
 * The one instruction for a session that wrote a draft: edit the listed spans in place and nothing else. Null with no
 * findings. Exported so a caller that adds findings of its own (a run copied from an excerpt) hands over one list.
 * @param {{ excerpt: string, line: number | null, say: string }[]} findings
 * @param {Spread | null} spread
 * @returns {string | null}
 */
export function instructionFor(findings: {
    excerpt: string;
    line: number | null;
    say: string;
}[], spread: Spread | null): string | null;
/**
 * The excerpts a model writes from, from the author's passages (newest first): at most one per passage, chosen so the set
 * holds one of the author's long sentences and one of their short ones, and the rest are the newest passages as they
 * come. Not the passages nearest the author's average: those show a model one sentence length, and it writes that length.
 * @param {string[]} passages
 * @param {number} [count]
 * @returns {string[]}
 */
export function voiceExcerpts(passages: string[], count?: number): string[];
export namespace SIGNS {
    let significance: string;
    let promotional: string;
    let vocabulary: string;
    let parallelism: string;
    let three: string;
    let collaborative: string;
    let placeholder: string;
    let markup: string;
    let cutoff: string;
    let refusal: string;
    let dash: string;
}
/**
 * "It's not just a house, it's a promise." / "This isn't only about money; it's about pride." / "It wasn't about money. It
 * was about pride." / "The best part was never just the book. It was the talk." / "Rereading is a gift, not a waste." /
 * "They are not simple; they are clear."
 */
export const NOT_JUST: RegExp[];
/**
 * Phrases current models still write, flagged in any text, each with what to do instead and the sign it maps to. Every
 * one was in the 2026-10-25 sample; a phrase that stops turning up in fresh output comes off.
 * @type {[string, string, string][]}
 */
export const TELLS: [string, string, string][];
/**
 * Words current models reach for in a blurb, a bio or an email that most writers rarely use. `checkProse` flags them in
 * any text; `slopScan` only when the author's own excerpts never use them, since a word the author writes is theirs.
 */
export const OUT_OF_PLACE: string[];
/** @typedef {{ check: string, sign: string, severity: Severity, re: RegExp, say: string }} PatternRule */
/**
 * What a chatbot leaves in text, an error in any published text whoever wrote the rest, so all high: its refusal, its
 * note on its training, a blank it left to fill, its citation markup and tracking tags. Only wording no person writes
 * to a reader: "Let me know if" and "I hope this helps" end real letters, so they are not here. Matched per line,
 * outside code.
 * @type {PatternRule[]}
 */
export const PATTERNS: PatternRule[];
/**
 * What a model is told before it writes, in plain words, so the checks have less to find. The habits are the ones
 * current models were seen to write (above); the rest are what the checks cannot see. Callers add the author's own
 * excerpts and guide.
 */
export const WRITING_RULES: "Write the way the author's excerpts read, not the way a model usually writes.\n\n- Say the thing. No run-up (\"Here's the truth:\", \"Great question\"), no reassurance before the answer, no closing summary, no moral at the end.\n- No closing verdict on a thing's worth (\"stays with you\", \"remains one of the most\") and no blurb adjectives (\"unforgettable\", \"haunting\", \"lyrical\", \"profound\"). End on a fact, or stop.\n- No \"not X, it's Y\", no \"It isn't about X. It's about Y.\" and no \"a gift, not a waste\".\n- Lists of three only when there are three things. Never end a paragraph on one for rhythm.\n- No dashes as all-purpose joiners. Use a comma, a full stop or brackets.\n- Contractions where the author uses them. Let each sentence run as long as its thought, as the excerpts' sentences do.\n- No hedging stacks (\"may potentially\", \"it could be argued\"). Commit, or say what you don't know and why.\n- Concrete over abstract: a number, a name, an example, a thing that happened. Cut a sentence that would fit any article on the subject. Every name and number comes from the author's writing or a source you list; a fact you can't point to comes out.\n- Active voice. Name who did it: \"we tested 393 samples\", not \"393 samples were tested\". This holds even where the excerpts are passive.\n- Don't open on a definition the reader already knows. Start with the case, the finding or the question.\n- No one-line stinger to end a paragraph, and no \"So\", \"And\" or \"But\" opening a sentence for effect, unless the excerpts write that way.\n- No sincerity markers (\"genuinely\", \"honestly\") and no reflex permission (\"no hard feelings\", \"that's completely fine\"). Say what happens next.\n- End when the answer is done. No offer of more (\"Would you like me to\") and no question to the reader at the end.\n- Bold, headings and questions to the reader only where the author's own writing uses them.";
/**
 * The least distance at which a text counts as reading unlike the passages (thresholdFor widens it to the author's own
 * range). Set between the fixtures in test/prose.test.mjs (measured
 * 2026-10-24: the passages themselves 0.46 to 0.54, the same register not in them 0.78, a public-domain passage by
 * Henry James 1.47). An app recalibrates once it holds the author's own text: the fixtures stand in for it.
 */
export const VOICE_THRESHOLD: 1.1;
export type SlopKind = "length" | "filler" | "word" | "shape" | "detail" | "source";
export type SlopFinding = {
    kind: SlopKind;
    excerpt: string;
    line: number;
    say: string;
};
export type Spread = {
    short: number;
    mid: number;
    long: number;
    longest: number;
};
export type Severity = "critical" | "high" | "medium" | "low";
export type ProseIssue = {
    check: string;
    message: string;
    excerpt: string | null;
    line: number | null;
    severity: Severity;
    sign: string | null;
};
export type PatternRule = {
    check: string;
    sign: string;
    severity: Severity;
    re: RegExp;
    say: string;
};
export type Features = Record<string, number>;
export type Profile = {
    mean: Features;
    spread: Features;
    chunks: number;
    words: number;
    usual?: number;
};
export type FeatureReading = {
    name: string;
    value: number;
    mean: number;
    z: number;
};
export type VoiceReading = {
    distance: number;
    furthest: FeatureReading[];
};
