/** The prose lines of a text with their line numbers, and whether each opens on a bold run: headings, code, tables and HTML blocks left out. @param {string} text @param {number} firstLine */
export function proseLines(text: string, firstLine: number): {
    text: string;
    line: number;
    bold: boolean;
}[];
/**
 * How long the author's sentences run, from their excerpts: the 10th percentile, the median and the 90th, over sentences
 * of four words or more. Null under five such sentences.
 * @param {string[]} excerpts
 * @returns {Spread | null}
 */
export function sentenceSpread(excerpts: string[]): Spread | null;
/** A sentence quoted short enough for a list line. @param {string} s */
export function quote(s: string): string;
/** The paragraphs of a text's prose lines, each with the line it starts on and the line it ends on. @param {{ text: string, line: number }[]} lines */
export function paragraphsOf(lines: {
    text: string;
    line: number;
}[]): {
    text: string;
    line: number;
    last: number;
}[];
/**
 * The excerpts a model writes from, from the author's passages (newest first): at most one per passage, chosen so the set
 * holds one of the author's long sentences and one of their short ones, and the rest are the newest passages as they
 * come. Not the passages nearest the author's average: those show a model one sentence length, and it writes that length.
 * @param {string[]} passages
 * @param {number} [count]
 * @returns {string[]}
 */
export function voiceExcerpts(passages: string[], count?: number): string[];
export type Spread = {
    short: number;
    mid: number;
    long: number;
    longest: number;
};
