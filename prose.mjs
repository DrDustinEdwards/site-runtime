/**
 * The one check on AI-written prose, and the one measure of an author's voice, for every app that has a model write text
 * a person will read: Carrel's drafts, Foxhound's emails. It flags; it never rewrites. What a flag means is the caller's
 * call: Carrel shows it to the author, Foxhound regenerates the email.
 *
 * The habits it looks for are the ones current Claude models were seen to write on 2026-10-25, with no style rules, across
 * book blurbs, bios, a companion's replies, UI copy, newsletters, journal posts, failed-payment and win-back emails, a
 * dispute statement and dashboard summaries (Capsid foxing/ai-writing-tells.md). The older lists ("delve", "tapestry",
 * "I hope this email finds you well") are gone: those models no longer write them. A tell goes on a list only after it
 * is seen in fresh model output, since a list that flags nothing a model writes only flags people.
 *
 * - `checkProse` flags `TELLS`, the words in `OUT_OF_PLACE`, the "not X, it's Y" construction across two sentences, a
 *   paragraph that closes on a list of three, the caller's own words and phrases, each dash on the line it sits on, and
 *   (`PATTERNS`) what a chatbot leaves in text whoever wrote the rest: a refusal, a note on its training, a blank, its
 *   citation markup. Each issue names the sign in Wikipedia's field guide (`SIGNS`) it maps to. Words the caller allows
 *   are dropped from every source.
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

import {
  VOICE_THRESHOLD,
  copiedRuns,
  describeFeature,
  distanceFrom,
  nearestPassages,
  profileOf,
  thresholdFor,
} from "./prose-voice.mjs";
/** @typedef {import("./prose-voice.mjs").Features} Features */
/** @typedef {import("./prose-voice.mjs").FeatureReading} FeatureReading */
/** @typedef {import("./prose-voice.mjs").Profile} Profile */
/** @typedef {import("./prose-voice.mjs").VoiceReading} VoiceReading */
/** @typedef {import("./prose-habits.mjs").Severity} Severity */
/** @typedef {import("./prose-habits.mjs").ProseIssue} ProseIssue */
/** @typedef {import("./prose-lines.mjs").Spread} Spread */
/** @typedef {import("./prose-scan.mjs").SlopKind} SlopKind */
/** @typedef {import("./prose-scan.mjs").SlopFinding} SlopFinding */

export {
  VOICE_THRESHOLD,
  copiedRuns,
  describeFeature,
  distanceFrom,
  nearestPassages,
  profileOf,
  thresholdFor,
};
export {
  NOT_JUST,
  OUT_OF_PLACE,
  PATTERNS,
  SIGNS,
  TELLS,
  WRITING_RULES,
  checkProse,
} from "./prose-habits.mjs";
export { sentenceSpread, voiceExcerpts } from "./prose-lines.mjs";
export { instructionFor, slopScan } from "./prose-scan.mjs";
