import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideEvaluation,
  evaluateDraft,
  initialRules,
  type RuleResult,
} from "./evaluator.js";

const sources = [{ text: "Painted with sponges." }];
const passingResults: RuleResult[] = [
  "text_length",
  "source_presence",
  "source_freshness",
  "content_grounding",
  "content_coverage",
].map((ruleId) => ({
  ruleId,
  outcome: "pass" as const,
  reason: "Passed.",
}));

test("grants eligibility only when every required rule passes", () => {
  assert.equal(decideEvaluation(passingResults), "eligible");
});

test("blocks when a required rule fails", () => {
  const results: RuleResult[] = passingResults.map((result) =>
    result.ruleId === "content_grounding"
      ? { ...result, outcome: "fail" }
      : result
  );

  assert.equal(decideEvaluation(results), "blocked");
});

test("requires review when a rule requires review", () => {
  const results: RuleResult[] = passingResults.map((result) =>
    result.ruleId === "content_coverage"
      ? { ...result, outcome: "review" }
      : result
  );

  assert.equal(decideEvaluation(results), "needs_review");
});

test("requires review when a rule errors", () => {
  const results: RuleResult[] = passingResults.map((result) =>
    result.ruleId === "content_grounding"
      ? { ...result, outcome: "error" }
      : result
  );

  assert.equal(decideEvaluation(results), "needs_review");
});

test("missing required results cannot yield eligibility", () => {
  assert.equal(
    decideEvaluation(passingResults.slice(0, -1)),
    "needs_review"
  );
});

test("unknown results cannot yield eligibility", () => {
  assert.equal(
    decideEvaluation([
      ...passingResults,
      {
        ruleId: "unknown_rule",
        outcome: "pass",
        reason: "Unknown.",
      },
    ]),
    "needs_review"
  );
});

test("duplicate results cannot yield eligibility", () => {
  assert.equal(
    decideEvaluation([...passingResults, passingResults[0]!]),
    "needs_review"
  );
});

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