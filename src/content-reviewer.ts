// src/content-reviewer.ts
import { claude } from "./claude.js";
import { resolveCoverage } from "./coverage.js";
import {
  reviewModel,
  reviewOutputSchema,
  reviewSchema,
  rubric,
  rubricVersion,
} from "./review-schema.js";

// Re-exported so existing callers keep their import path.
export {
  reviewModel,
  reviewOutputSchema,
  reviewSchema,
  rubric,
  rubricVersion,
};

export type { Review } from "./review-schema.js";

export type ReviewInput = {
  childName: string;
  observations: {
    id: string;
    text: string;
  }[];
  draft: string;
};

export type ReviewResult = {
  verdict: "supported" | "unsupported" | "uncertain";
  reason: string;
  coverage: {
    verdict: "complete" | "incomplete";
    covered: string[];
    missing: string[];
    unknown: string[];
    reason: string;
  };
  model: string;
  rubricVersion: string;
  usage: unknown;
};

export type ContentReviewer = (
  input: ReviewInput
) => Promise<ReviewResult>;

// Model judge: compares a draft with its evidence.
// It returns a judgement; it does not authorise publication.
export async function reviewContent(
  input: ReviewInput
): Promise<ReviewResult> {
  const response = await claude.messages.create({
    model: reviewModel,
    max_tokens: 500,
    system: rubric,
    messages: [
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ],
    // Sent verbatim. Do not wrap this in zodOutputFormat or
    // jsonSchemaOutputFormat: those helpers strip `enum`.
    output_config: {
      format: {
        type: "json_schema",
        schema: reviewOutputSchema,
      },
    },
  });

  // Failed or incomplete reviews must never be treated as passes.
  if (response.stop_reason !== "end_turn") {
    throw new Error(
      `Incomplete review: ${response.stop_reason}`
    );
  }

  const block = response.content.find(
    (item) => item.type === "text"
  );

  if (!block || block.type !== "text") {
    throw new Error("No review text returned");
  }

  const raw: unknown = JSON.parse(block.text);
  const validated = reviewSchema.safeParse(raw);

  if (!validated.success) {
    console.error("Raw review:", JSON.stringify(raw, null, 2));
    console.error(
      "Schema issues:",
      validated.error.issues
    );
    throw new Error(
      "Model response failed schema validation"
    );
  }

  const review = validated.data;

  // Coverage is decided here, from the IDs we supplied,
  // rather than from a model-generated verdict.
  const coverage = resolveCoverage(
    input.observations.map(
      (observation) => observation.id
    ),
    review.coverage.coveredObservationIds
  );

  return {
    verdict: review.verdict,
    reason: review.reason,
    coverage: {
      ...coverage,
      reason: review.coverage.reason,
    },
    model: response.model,
    rubricVersion,
    usage: response.usage,
  };
}