// src/review-rules.ts
//
// Turns the stored content review for a revision into the two
// review-based evaluation rules: content_grounding and content_coverage.
//
// These are pure functions so every branch can be unit tested without a
// database. The evaluations route loads the review and records the
// results; the decision about what each review state means lives here.

import type { RuleResult } from "./evaluator.js";

export type StoredContentReview = {
  status: string;
  verdict: string | null;
  reason: string | null;
  returned_model: string | null;
  coverage_verdict: string | null;
  coverage_reason: string | null;
  covered_observation_ids: string[] | null;
  missing_observation_ids: string[] | null;
  unknown_observation_ids: string[] | null;
};

type Outcome = RuleResult["outcome"];

const noReviewReason = "No completed matching content review.";
const failedReviewReason = "The content review failed to complete.";
const wrongModelReason =
  "The returned model does not match the required model.";

function groundingRule(
  outcome: Outcome,
  reason: string
): RuleResult {
  return {
    ruleId: "content_grounding",
    outcome,
    reason,
  };
}

function coverageRule(
  outcome: Outcome,
  reason: string
): RuleResult {
  return {
    ruleId: "content_coverage",
    outcome,
    reason,
  };
}

export function reviewRuleResults(
  review: StoredContentReview | undefined,
  requiredModel: string
): [RuleResult, RuleResult] {
  if (review?.status === "error") {
    return [
      groundingRule("error", failedReviewReason),
      coverageRule("error", failedReviewReason),
    ];
  }

  if (review?.status !== "completed") {
    return [
      groundingRule("review", noReviewReason),
      coverageRule("review", noReviewReason),
    ];
  }

  if (review.returned_model !== requiredModel) {
    return [
      groundingRule("error", wrongModelReason),
      coverageRule("error", wrongModelReason),
    ];
  }

  return [
    groundingRuleFor(review),
    coverageRuleFor(review),
  ];
}

function groundingRuleFor(
  review: StoredContentReview
): RuleResult {
  const outcome: Outcome =
    review.verdict === "supported"
      ? "pass"
      : review.verdict === "unsupported"
        ? "fail"
        : "review";

  return groundingRule(
    outcome,
    review.reason ?? "Content grounding requires attention."
  );
}

function coverageRuleFor(
  review: StoredContentReview
): RuleResult {
  const covered = review.covered_observation_ids;
  const missing = review.missing_observation_ids;
  const unknown = review.unknown_observation_ids;

  if (
    !Array.isArray(covered) ||
    !Array.isArray(missing) ||
    !Array.isArray(unknown) ||
    review.coverage_reason === null
  ) {
    return coverageRule(
      "error",
      "The completed content review has incomplete coverage evidence."
    );
  }

  if (
    review.coverage_verdict !== "complete" &&
    review.coverage_verdict !== "incomplete"
  ) {
    return coverageRule(
      "error",
      "The completed content review has an invalid coverage verdict."
    );
  }

  // The reviewer cited observations it was never given. Its account of
  // what the draft covers cannot be relied on, even if every supplied
  // observation also appears, so a person must check the draft.
  if (unknown.length > 0) {
    return coverageRule(
      "review",
      "The content review cited observations that were not supplied: " +
        unknown.join(", ")
    );
  }

  if (review.coverage_verdict === "incomplete") {
    return coverageRule("review", review.coverage_reason);
  }

  return coverageRule("pass", review.coverage_reason);
}