type RuleResult = {
    ruleId: string;
    outcome: "pass" | "fail";
    reason: string;
  };
  
  type Evaluation = {
    decision: "blocked" | "needs_review";
    results: RuleResult[];
  };
  
  export const evaluatorVersion = "basic-v1";
  
  export const initialRules = {
    maxCharacters: 1000,
    minSources: 1,
  };
  
  export function evaluateDraft(
    text: string,
    sources: unknown[],
    rules: typeof initialRules
  ): Evaluation {
    const length = Array.from(text.trim()).length;
    const lengthPassed = length > 0 && length <= rules.maxCharacters;
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
  
    return {
      decision: results.some((result) => result.outcome === "fail")
        ? "blocked"
        : "needs_review",
      results,
    };
  }