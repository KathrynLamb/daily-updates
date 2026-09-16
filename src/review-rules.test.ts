// src/review-rules.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewRuleResults,
  type StoredContentReview,
} from "./review-rules.js";
import { decideEvaluation, type RuleResult } from "./evaluator.js";

const model = "required-model";

function completedReview(
  overrides: Partial<StoredContentReview> = {}
): StoredContentReview {
  return {
    status: "completed",
    verdict: "supported",
    reason: "Every claim is supported.",
    returned_model: model,
    coverage_verdict: "complete",
    coverage_reason: "Every observation is represented.",
    covered_observation_ids: ["o1", "o2"],
    missing_observation_ids: [],
    unknown_observation_ids: [],
    ...overrides,
  };
}

function outcomes(results: RuleResult[]) {
  return results.map((result) => [result.ruleId, result.outcome]);
}

// The other three required rules, passing, so each test shows the
// effect of the review rules on the final decision.
const passingDeterministicRules: RuleResult[] = [
  "text_length",
  "source_presence",
  "source_freshness",
].map((ruleId) => ({
  ruleId,
  outcome: "pass",
  reason: "Passed.",
}));

function decisionFor(review: StoredContentReview | undefined) {
  return decideEvaluation([
    ...passingDeterministicRules,
    ...reviewRuleResults(review, model),
  ]);
}

test("a clean completed review passes both rules", () => {
  const results = reviewRuleResults(completedReview(), model);

  assert.deepEqual(outcomes(results), [
    ["content_grounding", "pass"],
    ["content_coverage", "pass"],
  ]);
  assert.equal(decisionFor(completedReview()), "eligible");
});

test("invented observation IDs send coverage to review", () => {
  const review = completedReview({
    unknown_observation_ids: ["o99", "o100"],
  });

  const [grounding, coverage] = reviewRuleResults(review, model);

  assert.equal(grounding.outcome, "pass");
  assert.equal(coverage.outcome, "review");
  assert.match(coverage.reason, /not supplied: o99, o100$/);
  assert.equal(decisionFor(review), "needs_review");
});

test("invented IDs are reported even when coverage is incomplete", () => {
  const review = completedReview({
    coverage_verdict: "incomplete",
    covered_observation_ids: ["o1"],
    missing_observation_ids: ["o2"],
    unknown_observation_ids: ["o99"],
  });

  const [, coverage] = reviewRuleResults(review, model);

  assert.equal(coverage.outcome, "review");
  assert.match(coverage.reason, /not supplied: o99$/);
});

test("incomplete coverage needs review", () => {
  const review = completedReview({
    coverage_verdict: "incomplete",
    coverage_reason: "o2 is not mentioned.",
    covered_observation_ids: ["o1"],
    missing_observation_ids: ["o2"],
  });

  const [, coverage] = reviewRuleResults(review, model);

  assert.deepEqual(coverage, {
    ruleId: "content_coverage",
    outcome: "review",
    reason: "o2 is not mentioned.",
  });
  assert.equal(decisionFor(review), "needs_review");
});

test("unsupported claims block the revision", () => {
  const review = completedReview({
    verdict: "unsupported",
    reason: "The draft mentions a trip that was not observed.",
  });

  const [grounding] = reviewRuleResults(review, model);

  assert.equal(grounding.outcome, "fail");
  assert.equal(decisionFor(review), "blocked");
});

test("an uncertain grounding verdict needs review", () => {
  const review = completedReview({
    verdict: "needs_review",
    reason: null,
  });

  const [grounding] = reviewRuleResults(review, model);

  assert.deepEqual(grounding, {
    ruleId: "content_grounding",
    outcome: "review",
    reason: "Content grounding requires attention.",
  });
});

test("a missing review needs review", () => {
  assert.deepEqual(
    outcomes(reviewRuleResults(undefined, model)),
    [
      ["content_grounding", "review"],
      ["content_coverage", "review"],
    ]
  );
  assert.equal(decisionFor(undefined), "needs_review");
});

test("a review that is still running needs review", () => {
  const review = completedReview({
    status: "running",
  });

  assert.deepEqual(
    outcomes(reviewRuleResults(review, model)),
    [
      ["content_grounding", "review"],
      ["content_coverage", "review"],
    ]
  );
});

test("a failed review is an error for both rules", () => {
  const review = completedReview({
    status: "error",
  });

  assert.deepEqual(
    outcomes(reviewRuleResults(review, model)),
    [
      ["content_grounding", "error"],
      ["content_coverage", "error"],
    ]
  );
  assert.equal(decisionFor(review), "needs_review");
});

test("a review from a different model is an error", () => {
  const review = completedReview({
    returned_model: "some-other-model",
  });

  assert.deepEqual(
    outcomes(reviewRuleResults(review, model)),
    [
      ["content_grounding", "error"],
      ["content_coverage", "error"],
    ]
  );
});

test("missing coverage evidence is an error", () => {
  for (const overrides of [
    { covered_observation_ids: null },
    { missing_observation_ids: null },
    { unknown_observation_ids: null },
    { coverage_reason: null },
  ]) {
    const [, coverage] = reviewRuleResults(
      completedReview(overrides),
      model
    );

    assert.equal(coverage.outcome, "error", JSON.stringify(overrides));
  }
});

test("an invalid coverage verdict is an error", () => {
  const [, coverage] = reviewRuleResults(
    completedReview({
      coverage_verdict: "mostly",
    }),
    model
  );

  assert.equal(coverage.outcome, "error");
});