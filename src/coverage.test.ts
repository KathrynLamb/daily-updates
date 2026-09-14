
// src/coverage.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCoverage } from "./coverage.js";

test("all observations claimed is complete", () => {
  const result = resolveCoverage(["o1", "o2"], ["o1", "o2"]);
  assert.equal(result.verdict, "complete");
  assert.deepEqual(result.missing, []);
});

test("an omitted observation is incomplete and named", () => {
  const result = resolveCoverage(["o1", "o2"], ["o1"]);
  assert.equal(result.verdict, "incomplete");
  assert.deepEqual(result.missing, ["o2"]);
});

test("claiming nothing is incomplete", () => {
  const result = resolveCoverage(["o1"], []);
  assert.equal(result.verdict, "incomplete");
  assert.deepEqual(result.missing, ["o1"]);
});

// The failure mode from the v1 rubric: draft content with no matching
// observation was treated as an incompleteness. It is now structurally
// impossible for an extra id to affect the verdict.
test("an invented id does not make coverage incomplete", () => {
  const result = resolveCoverage(["o1"], ["o1", "o99"]);
  assert.equal(result.verdict, "complete");
  assert.deepEqual(result.unknown, ["o99"]);
});

test("duplicate claims are harmless", () => {
  const result = resolveCoverage(["o1", "o2"], ["o1", "o1", "o2"]);
  assert.equal(result.verdict, "complete");
  assert.deepEqual(result.covered, ["o1", "o2"]);
});

test("order of claims does not matter", () => {
  const result = resolveCoverage(["o1", "o2"], ["o2", "o1"]);
  assert.equal(result.verdict, "complete");
});

test("no observations supplied is vacuously complete", () => {
  const result = resolveCoverage([], []);
  assert.equal(result.verdict, "complete");
});