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
export type SlopKind = "length" | "filler" | "word" | "shape" | "detail" | "source";
export type SlopFinding = {
    kind: SlopKind;
    excerpt: string;
    line: number;
    say: string;
};
export type Spread = import("./prose-lines.mjs").Spread;
