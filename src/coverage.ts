// src/coverage.ts
// Coverage is computed here, not judged by the model.
//
// The model is asked only which observation ids it can find represented in
// the draft. Whether that amounts to complete or incomplete is a set
// difference, so the direction of the relation is fixed by code and cannot
// be reinterpreted. This is the part that was leaking into the grounding
// verdict when both axes were model judgements.

export type CoverageVerdict = "complete" | "incomplete";

export type Coverage = {
  verdict: CoverageVerdict;
  covered: string[];
  missing: string[];
  // Ids the model returned that were never supplied. They do not change
  // the complete/incomplete verdict, which is a pure set difference, but
  // they mean the judge invented an id. Evaluation therefore sends any
  // review with unknown ids to human review (see review-rules.ts).
  unknown: string[];
};

export function resolveCoverage(
  suppliedIds: readonly string[],
  claimedIds: readonly string[]
): Coverage {
  const supplied = new Set(suppliedIds);
  const claimed = new Set(claimedIds);

  const covered = suppliedIds.filter((id) => claimed.has(id));
  const missing = suppliedIds.filter((id) => !claimed.has(id));
  const unknown = [...claimed].filter((id) => !supplied.has(id));

  return {
    verdict: missing.length === 0 ? "complete" : "incomplete",
    covered,
    missing,
    unknown,
  };
}