// src/approval-evidence.ts
//
// Approval and publication must both prove that the evidence behind a
// revision is still current at the moment they act. This module is the
// single place those checks live, so the two routes cannot drift apart.
//
// It reports which check failed rather than an HTTP response. Each route
// owns its own wording, because "not the latest revision" means
// something slightly different to an approver and a publisher.
//
// Callers must already hold the update row lock (SELECT ... FOR UPDATE)
// inside a SERIALIZABLE transaction, so that no newer revision can
// appear while these checks run.

import type { PoolClient } from "pg";
import {
  decideEvaluation,
  evaluatorVersion,
  type RuleResult,
} from "./evaluator.js";
import { sourcesAreCurrent } from "./source-freshness.js";
import {
  reviewModel,
  rubric,
  rubricVersion,
} from "./content-reviewer.js";

export type EvaluationEvidence = {
  updateId: string;
  draftRevisionId: string;
  evaluationRunId: string;
  evaluationStatus: string;
  evaluationDecision: string | null;
  evaluatorVersion: string;
  policyVersion: number;
  contentReviewId: string | null;
  sourceSnapshot: unknown;
  childId: string;
  observationDate: string;
};

// Listed in the order they are checked.
export const evidenceProblems = [
  "not_latest_revision",
  "evaluation_not_eligible",
  "evaluator_changed",
  "policy_changed",
  "missing_content_review",
  "content_review_not_current",
  "stored_results_not_eligible",
  "sources_changed",
] as const;

export type EvidenceProblem = (typeof evidenceProblems)[number];

export async function findEvidenceProblem(
  client: PoolClient,
  evidence: EvaluationEvidence
): Promise<EvidenceProblem | null> {
  const latestRevisions = await client.query<{
    id: string;
  }>(
    `SELECT id
     FROM draft_revisions
     WHERE update_id = $1
     ORDER BY revision_number DESC
     LIMIT 1`,
    [evidence.updateId]
  );

  if (latestRevisions.rows[0]?.id !== evidence.draftRevisionId) {
    return "not_latest_revision";
  }

  if (
    evidence.evaluationStatus !== "completed" ||
    evidence.evaluationDecision !== "eligible"
  ) {
    return "evaluation_not_eligible";
  }

  if (evidence.evaluatorVersion !== evaluatorVersion) {
    return "evaluator_changed";
  }

  const activePolicies = await client.query<{
    policy_version: number;
  }>(
    `SELECT policy_version
     FROM active_evaluation_policy
     WHERE id = 1
     FOR SHARE`
  );

  if (
    activePolicies.rows[0]?.policy_version !==
    evidence.policyVersion
  ) {
    return "policy_changed";
  }

  if (!evidence.contentReviewId) {
    return "missing_content_review";
  }

  const reviews = await client.query<{
    status: string;
    requested_model: string;
    returned_model: string | null;
    rubric_version: string;
    rubric_text: string;
  }>(
    `SELECT
       status,
       requested_model,
       returned_model,
       rubric_version,
       rubric_text
     FROM content_reviews
     WHERE id = $1
       AND draft_revision_id = $2`,
    [evidence.contentReviewId, evidence.draftRevisionId]
  );

  const review = reviews.rows[0];

  if (
    !review ||
    review.status !== "completed" ||
    review.requested_model !== reviewModel ||
    review.returned_model !== reviewModel ||
    review.rubric_version !== rubricVersion ||
    review.rubric_text !== rubric
  ) {
    return "content_review_not_current";
  }

  // The stored decision is not trusted on its own; the stored rule
  // results are decided again with today's decision logic.
  const results = await client.query<RuleResult>(
    `SELECT
       rule_id AS "ruleId",
       outcome,
       reason
     FROM evaluation_results
     WHERE evaluation_run_id = $1
     ORDER BY rule_id`,
    [evidence.evaluationRunId]
  );

  if (decideEvaluation(results.rows) !== "eligible") {
    return "stored_results_not_eligible";
  }

  const currentSources = await client.query(
    `SELECT
       id,
       child_id,
       observation_date::text AS observation_date,
       category,
       text
     FROM observations
     WHERE child_id = $1
       AND observation_date = $2`,
    [evidence.childId, evidence.observationDate]
  );

  if (
    !sourcesAreCurrent(
      evidence.sourceSnapshot,
      currentSources.rows
    )
  ) {
    return "sources_changed";
  }

  return null;
}