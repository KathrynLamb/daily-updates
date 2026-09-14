export type RuleResult = {
  ruleId: string;
  outcome: "pass" | "fail" | "error" | "review";
  reason: string;
};

export type EvaluationDecision =
  | "eligible"
  | "needs_review"
  | "blocked";

type Evaluation = {
  decision: EvaluationDecision;
  results: RuleResult[];
};

export const evaluatorVersion = "basic-v4";

export const initialRules = {
  maxCharacters: 1000,
  minSources: 1,
};

const requiredRuleIds = [
  "text_length",
  "source_presence",
  "source_freshness",
  "content_grounding",
  "content_coverage",
] as const;

export function decideEvaluation(
  results: RuleResult[]
): EvaluationDecision {
  // A definite rule failure always blocks the revision.
  if (results.some((result) => result.outcome === "fail")) {
    return "blocked";
  }

  const suppliedRuleIds = new Set(
    results.map((result) => result.ruleId)
  );

  // Missing, duplicate, or unknown rules cannot produce eligibility.
  const hasExactRequiredRules =
    results.length === requiredRuleIds.length &&
    suppliedRuleIds.size === requiredRuleIds.length &&
    requiredRuleIds.every((ruleId) =>
      suppliedRuleIds.has(ruleId)
    );

  if (!hasExactRequiredRules) {
    return "needs_review";
  }

  if (
    results.some(
      (result) =>
        result.outcome === "error" ||
        result.outcome === "review"
    )
  ) {
    return "needs_review";
  }

  return "eligible";
}

export function evaluateDraft(
  text: string,
  sources: unknown[],
  rules: typeof initialRules
): Evaluation {
  const length = Array.from(text.trim()).length;
  const lengthPassed =
    length > 0 && length <= rules.maxCharacters;
  const sourcesPassed = sources.length >= rules.minSources;

  const results: RuleResult[] = [
    {
      ruleId: "text_length",
      outcome: lengthPassed ? "pass" : "fail",
      reason: `${length} characters; allowed: 1–${rules.maxCharacters}.`,
    },
    {
      ruleId: "source_presence",
      outcome: sourcesPassed ? "pass" : "fail",
      reason: `${sources.length} sources; minimum: ${rules.minSources}.`,
    },
  ];

  // These are only preliminary checks. Content review and source
  // freshness must be added before eligibility can be granted.
  return {
    decision: results.some((result) => result.outcome === "fail")
      ? "blocked"
      : "needs_review",
    results,
  };
}