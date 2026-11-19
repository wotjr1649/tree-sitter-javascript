import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../classify.mjs";

const verdict = (b, o) => ({ b: { script: { c: b } }, o: { script: { c: o } } });
const clean = { clean: true, err: false };
const broken = { clean: false, err: true };

test("valid input the grammar does not parse cleanly is A1 when both tools accept, A2 when one rejects", () => {
  assert.equal(classify({ truth: "valid", ...verdict("accept", "accept") }, broken).cat, "A1");
  assert.equal(classify({ truth: "valid", ...verdict("accept", "syntax") }, broken).cat, "A2");
});

test("invalid input the grammar accepts: B1 syntax, B2 early, B3 when the tools cannot tell", () => {
  assert.equal(classify({ truth: "invalid", ...verdict("syntax", "syntax") }, clean).cat, "B1");
  assert.equal(classify({ truth: "invalid", ...verdict("early", "early") }, clean).cat, "B2");
  assert.equal(classify({ truth: "invalid", ...verdict("early", "syntax") }, clean).cat, "B3");
  assert.equal(classify({ truth: "invalid", ...verdict("accept", "accept") }, clean).cat, "B3");
});

test("agreement with the truth is ok; a timeout is T", () => {
  assert.equal(classify({ truth: "valid", ...verdict("accept", "accept") }, clean).cat, "ok");
  assert.equal(classify({ truth: "invalid", ...verdict("syntax", "syntax") }, broken).cat, "ok");
  assert.equal(classify({ truth: "valid", ...verdict("accept", "accept") }, { timeout: true }).cat, "T");
});

test("without truth the tools decide: agreement gives the truth, disagreement is C", () => {
  assert.equal(classify({ truth: "unknown", ...verdict("accept", "accept") }, broken).cat, "A1");
  assert.equal(classify({ truth: "unknown", ...verdict("syntax", "syntax") }, clean).cat, "B1");
  assert.equal(classify({ truth: "unknown", ...verdict("accept", "syntax") }, clean).cat, "C");
});

test("the deciding source type is the first one both tools accept", () => {
  const rec = { truth: "unknown", b: { script: { c: "syntax" }, module: { c: "accept" } }, o: { script: { c: "syntax" }, module: { c: "accept" } } };
  assert.equal(classify(rec, broken).type, "module");
});
