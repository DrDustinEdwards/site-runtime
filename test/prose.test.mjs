// The prose check and the voice measure. PLANT tests fail if the habit or guard they name stops being caught; CLEAN
// TWIN tests hold the same ideas, written plainly, to no flags, so a pattern that grows to catch ordinary prose goes red.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EMAIL_PHRASES, checkProse, distanceFrom, nearestPassages, profileOf, VOICE_THRESHOLD } from "../prose.mjs";
import { BASELINE, PLANT, TWIN } from "./fixtures/voice.mjs";

const checks = (/** @type {string} */ text, /** @type {Parameters<typeof checkProse>[1]} */ options) =>
  checkProse(text, options).map((i) => i.check);

describe("checkProse", () => {
  test("PLANT: the engine's word list, quoted on its own line", () => {
    const found = checkProse("We walked home.\nIt is a testament to the town.\n", { firstLine: 10 });
    assert.deepEqual(
      found.map((i) => [i.excerpt, i.line]),
      [["testament to", 11]],
    );
  });

  test("PLANT: \"not X, it's Y\" in one sentence and across two", () => {
    assert.ok(checks("It's not just a house, it's a promise.").includes("not-x-but-y"));
    assert.ok(checks("This wasn't about money. It was about pride.").includes("not-x-but-y"));
    assert.ok(checks("It is not just a tool. It is a way of working.").includes("not-x-but-y"));
  });

  test("PLANT: a paragraph that closes on a list of three, on the line it ends", () => {
    const found = checkProse("She stood on the porch.\nIt was bold, brave, and bright.\n\nThen rain.", { firstLine: 3 });
    assert.deepEqual(
      found.filter((i) => i.check === "closing-triad").map((i) => [i.excerpt, i.line]),
      [["It was bold, brave, and bright.", 4]],
    );
  });

  test("PLANT: each dash on its line, unless the author allows them", () => {
    const text = "We left early — the road was out.\nNo dash here.\nThen – again.";
    assert.deepEqual(
      checkProse(text).filter((i) => i.check === "dash").map((i) => i.line),
      [1, 3],
    );
    assert.equal(checks(text, { dashes: "allow" }).includes("dash"), false);
  });

  test("PLANT: the caller's phrases, and words allowed back out of every list", () => {
    const email = "Hi Sam,\n\nI hope this email finds you well. Your card didn't go through.\n";
    assert.deepEqual(
      checkProse(email, { phrases: EMAIL_PHRASES }).map((i) => [i.check, i.line]),
      [["phrase", 3]],
    );
    assert.deepEqual(checks("A testament to the town.", { allow: ["testament to"] }), []);
    assert.deepEqual(checks(email, { phrases: EMAIL_PHRASES, allow: ["I hope this email finds you well"] }), []);
  });

  test("CLEAN TWIN: the same ideas, written plainly, are not flagged", () => {
    const plain = [
      "We walked home. The town showed what it was made of.",
      "",
      "It's not raining, so we walked. It was a house, and he meant it as a promise.",
      "",
      "She bought eggs, flour, and a sack of rice for the week. Then she drove north.",
      "",
      "Hi Sam, your card didn't go through on the 3rd. You can update it here.",
    ].join("\n");
    assert.deepEqual(checkProse(plain, { phrases: EMAIL_PHRASES }), []);
  });
});

describe("the voice measure", () => {
  const profile = profileOf(BASELINE);

  test("PLANT: another author's passage reads past the threshold, its furthest features named", () => {
    assert.ok(profile);
    const reading = distanceFrom(profile, PLANT);
    assert.ok(reading && reading.distance >= VOICE_THRESHOLD, `distance ${reading?.distance}`);
    assert.equal(reading.furthest[0].name, "sentence length");
  });

  test("CLEAN TWIN: more of the same register, not in the passages, reads under it", () => {
    assert.ok(profile);
    const reading = distanceFrom(profile, TWIN);
    assert.ok(reading && reading.distance < VOICE_THRESHOLD, `distance ${reading?.distance}`);
  });

  test("silent on too little text, and the nearest excerpts come from the passages", () => {
    assert.equal(profileOf([BASELINE[0].slice(0, 400)]), null);
    assert.ok(profile);
    assert.equal(distanceFrom(profile, PLANT.slice(0, 600)), null);
    const nearest = nearestPassages(profile, [...BASELINE, PLANT], 3);
    assert.equal(nearest.length, 3);
    assert.ok(nearest.every((t) => !t.includes("afternoon tea")));
  });
});
