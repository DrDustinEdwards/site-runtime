// The prose check and the voice measure. PLANT tests fail if the habit or guard they name stops being caught; CLEAN
// TWIN tests hold the same ideas, written plainly, to no flags, so a pattern that grows to catch ordinary prose goes red.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkProse, copiedRuns, distanceFrom, nearestPassages, profileOf, sentenceSpread, slopScan, thresholdFor, voiceExcerpts, VOICE_THRESHOLD } from "../prose.mjs";
import { BASELINE, PLANT, TWIN } from "./fixtures/voice.mjs";

const checks = (/** @type {string} */ text, /** @type {Parameters<typeof checkProse>[1]} */ options) =>
  checkProse(text, options).map((i) => i.check);

describe("checkProse", () => {
  test("PLANT: a phrase and a word current models still write, quoted on their line", () => {
    const found = checkProse("We walked home.\nGreat question. The ending is a haunting one.\n", { firstLine: 10 });
    assert.deepEqual(
      found.map((i) => [i.check, i.excerpt, i.line]),
      [["tell", "Great question", 11], ["word", "haunting", 11]],
    );
  });

  test("PLANT: \"not X, it's Y\" in one sentence and across two, reported once", () => {
    for (const text of ["It's not just a house, it's a promise.", "This wasn't about money.\nIt was about pride.", "It is not just a tool. It is a way of working.", "She stood a while.\nIt's not just a house, it's a promise."]) {
      const found = checks(text).filter((c) => c === "not-x-but-y");
      assert.equal(found.length, 1, text);
    }
  });

  test("PLANT: a paragraph that closes on a list of three, on the line it ends", () => {
    const found = checkProse("She stood on the porch.\nIt was bold, brave, and bright.\n\nThen rain.", { firstLine: 3 });
    assert.deepEqual(
      found.filter((i) => i.check === "closing-triad").map((i) => [i.excerpt, i.line]),
      [["It was bold, brave, and bright.", 4]],
    );
  });

  test("PLANT: each dash on its line, unless the author allows them; an unspaced en dash is a range", () => {
    const text = "We left early — the road was out.\nNo dash here, 2019–2024 and pp. 12–14.\nThen – again.";
    assert.deepEqual(
      checkProse(text).filter((i) => i.check === "dash").map((i) => i.line),
      [1, 3],
    );
    assert.equal(checks(text, { dashes: "allow" }).includes("dash"), false);
  });

  test("PLANT: the caller's phrases, and words allowed back out of every list", () => {
    assert.deepEqual(
      checkProse("A tapestry. Another tapestry, and a testament to it.", { phrases: ["tapestry", "testament to"] }).map((i) => i.excerpt).sort(),
      ["tapestry", "tapestry", "testament to"],
    );
    assert.deepEqual(checks("It stays with you.", { allow: ["stays with you"] }), []);
    assert.deepEqual(checks("We genuinely mean it.", { allow: ["genuinely"] }), []);
  });

  test("CLEAN TWIN: the same ideas, written plainly, are not flagged", () => {
    const plain = [
      "We walked home. The town showed what it was made of.",
      "",
      "It's not raining, so we walked. It was a house, and he meant it as a promise.",
      "",
      "She bought eggs, flour, and a sack of rice for the week. Then she drove north.",
      "",
      "Hi Sam, your card didn't go through on the 3rd. You can update it here. If you'd rather stop, do nothing.",
      "",
      "That was a good question. The book stayed on my desk for a month.",
      "",
      "It wasn't raining.",
      "We walked to town and back.",
    ].join("\n");
    assert.deepEqual(checkProse(plain), []);
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

  test("the threshold widens to the author's own range, and a copied run is found", () => {
    assert.ok(profile);
    assert.ok(profile.usual && profile.usual < VOICE_THRESHOLD, `usual ${profile?.usual}`);
    assert.equal(thresholdFor({ ...profile, usual: 1.6 }), 1.6);
    const source = BASELINE[0];
    const run = source.split(/\s+/).slice(10, 22).join(" ");
    assert.equal(copiedRuns(`New words first. ${run} and then mine.`, [source]).length, 1);
    assert.deepEqual(copiedRuns("Nothing here comes from the passages at all, not one run of eight.", [source]), []);
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

describe("slopScan", () => {
  // BASELINE's sentences run 5, 10 and 18 words (10th percentile, median, 90th), the longest 27.
  const scan = (/** @type {string} */ text, excerpts = BASELINE) => slopScan(text, excerpts).findings;
  const kinds = (/** @type {string} */ text, excerpts = BASELINE) => scan(text, excerpts).map((f) => f.kind);

  test("PLANT: four sentences of the same length, when the author's vary, are one finding on the first", () => {
    const even =
      "The team reviewed the quarterly numbers and found a steady rise in sales. " +
      "The new process cut the waiting time for nearly all of our regular customers. " +
      "Our support staff answered many more questions each week than they had before. " +
      "The product team shipped three small updates that fixed the slowest pages on the site.";
    const found = scan(even);
    assert.deepEqual(found.map((f) => [f.kind, f.line]), [["length", 1]]);
    assert.match(found[0].say, /^These four sentences are all about 14 words\. The excerpts run from 5 to 18\./);
  });

  test("PLANT: a sentence eight words past the author's long ones, and past their longest", () => {
    const long =
      "When we finally reached the end of the gravel road after the long drive from town we found that somebody had chained the gate " +
      "and that someone had cut the grass and painted the fence white.";
    const found = scan(long);
    assert.deepEqual(found.map((f) => f.kind), ["length"]);
    assert.match(found[0].say, /^This is 36 words\. The long sentences in the excerpts are about 18\./);
  });

  test("PLANT: a word the excerpts never use, filler, a joiner dash, and a padded closing list", () => {
    assert.deepEqual(kinds("The river was a haunting light."), ["word"]);
    assert.deepEqual(kinds("Great question. The river was up."), ["filler"]);
    assert.deepEqual(kinds("We left early \u2014 the road was out."), ["shape"]);
    assert.deepEqual(kinds("We fixed the roof.\nThe result was haunting, lyrical, and profound."), ["shape"]);
  });

  test("the instruction names each span and the author's spread, and edits in place", () => {
    const { instruction } = slopScan("Great question. The river was up.", BASELINE, { firstLine: 7 });
    assert.equal(
      instruction,
      [
        "Edit the draft in place. Change only the spans listed. Keep every fact, name, number, and link. Leave every other sentence as it is.",
        "The excerpts' sentences run about 5, 10, and 18 words. Stay inside that spread. Do not alternate short and long on purpose.",
        '- Line 7, "Great question": Answer the question. Cut the compliment.',
      ].join("\n"),
    );
    assert.equal(slopScan("The river was up.", ["Too short to measure."]).instruction, null);
  });

  test("CLEAN TWIN: the author's own words, ranges, real lists and their own pages pass", () => {
    assert.deepEqual(kinds("The river was a haunting light.", [...BASELINE, "The owl was haunting the barn all winter."]), []);
    assert.deepEqual(kinds("She bought eggs, flour, and a sack of rice for the week."), []);
    assert.deepEqual(kinds("From 2019-2024 the same protocol held, and from 2019\u20132024 too."), []);
    assert.deepEqual(kinds("We left early \u2014 the road was out.", BASELINE.map((b) => b.replace(/\. /g, " \u2014 "))), []);
    // The passive is the Owner's rule for every draft, so it is the one finding an author's own page can carry.
    for (const page of [...BASELINE, TWIN]) assert.deepEqual(scan(page).filter((f) => !f.say.startsWith("Passive")), []);
  });

  // A scientist's plain report: numbers and names in every paragraph, no stinger, no "So" opener.
  const papers = [
    "In 2016, 393 blood samples from Rio Grande wild turkeys in Erath County went to the lab at Tarleton for testing. Five of the 98 birds from Hood County carried REV, and one of 62 eastern birds imported from Missouri did too. Fossil Rim lost nearly half its adult prairie chickens that year.",
    "We sequenced the Arlo genome at the Pittsburgh Bacteriophage Institute in 2018. It is 52,960 base pairs long, with 96 predicted genes, and Arlo sits in cluster A1 next to DD5 and Oogway, two phages found in Pennsylvania and Texas.",
    "Students in BIOL 1407 at Tarleton found 14 new phages in 2019 from soil around Stephenville, Bluff Dale and Glen Rose. Seven of them went to Pittsburgh for sequencing, and three of those were published in Microbiology Resource Announcements that year.",
  ];

  test("PLANT: a definition opening, a paragraph with nothing specific, the passive, and a wrap-up ending", () => {
    const draft =
      "Bacteriophages are viruses that infect bacteria, and most of them infect only a narrow range of hosts. A phage that grows on one strain will often fail on a closely related one. " +
      "This specificity is determined largely at the first step of infection, when proteins at the tip of the tail bind to receptors on the surface. If the receptor is absent, the phage cannot attach.\n\n" +
      "This is one reason that phages from the same soil can differ widely in which bacteria they infect.";
    const found = scan(draft, papers);
    assert.deepEqual(found.map((f) => f.say.split(/[.:]/)[0]), [
      "Nothing in this paragraph is specific",
      "This opens on a definition the reader already knows",
      "Passive",
      "This sums up what was just said",
    ]);
  });

  test("PLANT: a stinger and a \"So\" opener, flagged only when the excerpts never write them", () => {
    const stinger = "We fixed the roof in June. The rain held off for a week. The crew left on the Friday. There was a cost.";
    assert.deepEqual(kinds(stinger, papers), ["shape"]);
    assert.deepEqual(kinds("So we drove back to town.", papers), ["shape"]);
    assert.deepEqual(kinds("So we drove back to town.", [...BASELINE, "So I went. And then I came back."]), []);
  });
});

describe("voiceExcerpts", () => {
  test("one per passage, holding one of the author's long sentences and one short one", () => {
    const spread = sentenceSpread(BASELINE);
    assert.ok(spread);
    const picked = voiceExcerpts(BASELINE, 3);
    assert.equal(picked.length, 3);
    const lengths = picked.flatMap((p) => p.split(/(?<=[.!?])\s+/)).map((s) => s.split(/\s+/).length);
    assert.ok(lengths.some((n) => n >= spread.long));
    assert.ok(lengths.some((n) => n <= spread.short));
  });
});
