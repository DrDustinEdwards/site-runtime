/** Up to twenty characters either side of a match. @param {string} line @param {number} at @param {number} length */
export function around(line: string, at: number, length: number): string;
/** A whole-word, any-case match for a word or phrase, with either apostrophe. @param {string} phrase */
export function phraseRegExp(phrase: string): RegExp;
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
/** A sentence that closes its paragraph on a three-item list of one- or two-word items. */
export const CLOSING_TRIAD: RegExp;
/** An em dash anywhere, an en dash only with spaces round it (an unspaced one is a range: 2019–2024, pp. 12–14). */
export const DASH: RegExp;
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
