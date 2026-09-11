import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDraft, initialRules } from "./evaluator.js";

const sources = [{ text: "Painted with sponges." }];

test("basic passes still require content review", () => {
  const result = evaluateDraft("Ava painted.", sources, initialRules);

  assert.equal(result.decision, "needs_review");
  assert.ok(result.results.every((rule) => rule.outcome === "pass"));
});

test("accepts the exact character limit", () => {
  const result = evaluateDraft(
    "a".repeat(initialRules.maxCharacters),
    sources,
    initialRules
  );

  assert.equal(result.decision, "needs_review");
});

test("blocks text exceeding the limit", () => {
  const result = evaluateDraft(
    "a".repeat(initialRules.maxCharacters + 1),
    sources,
    initialRules
  );

  assert.equal(result.decision, "blocked");
  assert.equal(result.results[0].outcome, "fail");
});

test("blocks missing sources", () => {
  const result = evaluateDraft("Ava painted.", [], initialRules);

  assert.equal(result.decision, "blocked");
  assert.equal(result.results[1].outcome, "fail");
});

test("blocks whitespace-only text", () => {
  const result = evaluateDraft("   ", sources, initialRules);

  assert.equal(result.decision, "blocked");
  assert.equal(result.results[0].outcome, "fail");
});