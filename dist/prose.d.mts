export type Features = import("./prose-voice.mjs").Features;
export type FeatureReading = import("./prose-voice.mjs").FeatureReading;
export type Profile = {
    mean: Features;
    spread: Features;
    chunks: number;
    words: number;
    usual?: number;
};
export type VoiceReading = {
    distance: number;
    furthest: FeatureReading[];
};
export type Severity = import("./prose-habits.mjs").Severity;
export type ProseIssue = {
    check: string;
    message: string;
    excerpt: string | null;
    line: number | null;
    severity: Severity;
    sign: string | null;
};
export type Spread = {
    short: number;
    mid: number;
    long: number;
    longest: number;
};
export type SlopKind = import("./prose-scan.mjs").SlopKind;
export type SlopFinding = {
    kind: SlopKind;
    excerpt: string;
    line: number;
    say: string;
};
export type PatternRule = {
    check: string;
    sign: string;
    severity: Severity;
    re: RegExp;
    say: string;
};
import { VOICE_THRESHOLD } from "./prose-voice.mjs";
import { copiedRuns } from "./prose-voice.mjs";
import { describeFeature } from "./prose-voice.mjs";
import { distanceFrom } from "./prose-voice.mjs";
import { nearestPassages } from "./prose-voice.mjs";
import { profileOf } from "./prose-voice.mjs";
import { thresholdFor } from "./prose-voice.mjs";
export { VOICE_THRESHOLD, copiedRuns, describeFeature, distanceFrom, nearestPassages, profileOf, thresholdFor };
export { NOT_JUST, OUT_OF_PLACE, PATTERNS, SIGNS, TELLS, WRITING_RULES, checkProse } from "./prose-habits.mjs";
export { sentenceSpread, voiceExcerpts } from "./prose-lines.mjs";
export { instructionFor, slopScan } from "./prose-scan.mjs";
