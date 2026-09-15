// test/integration/workflow.test.ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/db.js";
import {
  reviewModel,
  rubricVersion,
  type ContentReviewer,
} from "../../src/content-reviewer.js";
import type { Authenticator } from "../../src/authentication.js";

let reviewerCallCount = 0;

const fakeReviewer: ContentReviewer = async (input) => {
  reviewerCallCount += 1;
  const draft = input.draft.toLowerCase();

  const covered = input.observations
    .filter((observation) =>
      draft.includes(
        observation.text
          .toLowerCase()
          .replace(/\.$/, "")
      )
    )
    .map((observation) => observation.id);

  const coveredIds = new Set(covered);

  const missing = input.observations
    .map((observation) => observation.id)
    .filter((id) => !coveredIds.has(id));

  return {
    verdict: "supported",
    reason: "All claims are supported by the test evidence.",
    coverage: {
      verdict:
        missing.length === 0
          ? "complete"
          : "incomplete",
      covered,
      missing,
      unknown: [],
      reason:
        missing.length === 0
          ? "All observations are represented."
          : "One or more observations are omitted.",
    },
    model: reviewModel,
    rubricVersion,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
};

const integrationUserId =
  "00000000-0000-4000-8000-000000000001";

// A same-setting practitioner: may draft, may not approve.
const practitionerUserId =
  "00000000-0000-4000-8000-000000000002";

// An approver, but for a different setting.
const outsideApproverUserId =
  "00000000-0000-4000-8000-000000000003";

const testUserHeader = "x-test-user-id";

// Tests act as the default approver unless a request names
// another seeded user in the test header.
const fakeAuthenticator: Authenticator = async (request) => {
  const requested = request.headers[testUserHeader];
  const userId =
    typeof requested === "string"
      ? requested
      : integrationUserId;

  return {
    userId,
    issuer: "https://identity.example.test",
    subject: userId,
  };
};

function asUser(userId: string) {
  return {
    [testUserHeader]: userId,
  };
}

const app = buildApp({
  logger: false,
  reviewer: fakeReviewer,
  authenticator: fakeAuthenticator,
});

before(async () => {
    await pool.query(
      `INSERT INTO settings (id, name)
       VALUES ($1, $2)`,
      [
        "integration-setting",
        "Integration Test Setting",
      ]
    );

    await pool.query(
      `INSERT INTO children (
         id,
         setting_id,
         first_name
       )
       VALUES ($1, $2, $3)`,
      [
        "integration-ava",
        "integration-setting",
        "Ava",
      ]
    );
    await pool.query(
      `INSERT INTO app_users (
         id,
         identity_issuer,
         identity_subject
       )
       VALUES ($1, $2, $3)`,
      [
        integrationUserId,
        "https://identity.example.test",
        "integration-user",
      ]
    );

    await pool.query(
      `INSERT INTO setting_memberships (
         user_id,
         setting_id,
         role
       )
       VALUES ($1, $2, $3)`,
      [
        integrationUserId,
        "integration-setting",
        "approver",
      ]
    );

    await pool.query(
      `INSERT INTO app_users (
         id,
         identity_issuer,
         identity_subject
       )
       VALUES
         ($1::uuid, $3, $1::text),
         ($2::uuid, $3, $2::text)`,
      [
        practitionerUserId,
        outsideApproverUserId,
        "https://identity.example.test",
      ]
    );

    await pool.query(
      `INSERT INTO setting_memberships (
         user_id,
         setting_id,
         role
       )
       VALUES ($1, $2, $3)`,
      [
        practitionerUserId,
        "integration-setting",
        "practitioner",
      ]
    );

    await pool.query(
      `INSERT INTO settings (id, name)
       VALUES ($1, $2)`,
      [
        "other-setting",
        "Other Test Setting",
      ]
    );

    await pool.query(
      `INSERT INTO children (
         id,
         setting_id,
         first_name
       )
       VALUES ($1, $2, $3)`,
      [
        "other-child",
        "other-setting",
        "Other Child",
      ]
    );

    await pool.query(
      `INSERT INTO setting_memberships (
         user_id,
         setting_id,
         role
       )
       VALUES ($1, $2, $3)`,
      [
        outsideApproverUserId,
        "other-setting",
        "approver",
      ]
    );
  });

after(async () => {
  await app.close();
  await pool.end();
});

async function createObservation(
  childId: string,
  observationDate: string,
  category: "activity" | "food" | "sleep" | "general",
  text: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/observations",
    payload: {
      childId,
      observationDate,
      category,
      text,
    },
  });

  assert.equal(response.statusCode, 201, response.body);
}

test(
  "staff cannot access a child from another setting",
  async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/observations",
      payload: {
        childId: "other-child",
        observationDate: "2026-09-22",
        category: "activity",
        text: "Played outside.",
      },
    });

    assert.equal(createResponse.statusCode, 403);
    assert.deepEqual(createResponse.json(), {
      error:
        "Not permitted to create observations for this child",
    });

    const readResponse = await app.inject({
      method: "GET",
      url: "/children/other-child/observations",
    });

    assert.equal(readResponse.statusCode, 403);
    assert.deepEqual(readResponse.json(), {
      error:
        "Not permitted to read observations for this child",
    });

    const draftResponse = await app.inject({
      method: "POST",
      url: "/drafts",
      payload: {
        childId: "other-child",
        observationDate: "2026-09-22",
        text: "Other Child played outside.",
      },
    });

    assert.equal(draftResponse.statusCode, 403);
    assert.deepEqual(draftResponse.json(), {
      error:
        "Not permitted to create drafts for this child",
    });

    const otherUpdate = await pool.query<{
      id: string;
    }>(
      `INSERT INTO updates (
         child_id,
         observation_date
       )
       VALUES ($1, $2)
       RETURNING id`,
      [
        "other-child",
        "2026-09-23",
      ]
    );

    const otherUpdateId = otherUpdate.rows[0]?.id;

    assert.ok(otherUpdateId);

    const otherRevision = await pool.query<{
      id: string;
    }>(
      `INSERT INTO draft_revisions (
         update_id,
         revision_number,
         text,
         source_snapshot
       )
       VALUES ($1, 1, $2, '[]'::jsonb)
       RETURNING id`,
      [
        otherUpdateId,
        "A private draft from another setting.",
      ]
    );

    const otherRevisionId =
      otherRevision.rows[0]?.id;

    assert.ok(otherRevisionId);

    const revisionResponse = await app.inject({
      method: "POST",
      url: `/updates/${otherUpdateId}/revisions`,
      payload: {
        expectedRevision: 1,
        text: "Attempted unauthorised revision.",
        refreshSources: false,
      },
    });

    assert.equal(revisionResponse.statusCode, 403);
    assert.deepEqual(revisionResponse.json(), {
      error: "Not permitted to revise this update",
    });

    const callsBeforeUnauthorisedReview =
      reviewerCallCount;

    const reviewResponse = await app.inject({
      method: "POST",
      url:
        `/revisions/${otherRevisionId}` +
        "/content-reviews",
    });

    assert.equal(reviewResponse.statusCode, 403);
    assert.deepEqual(reviewResponse.json(), {
      error: "Not permitted to review this revision",
    });

    assert.equal(
      reviewerCallCount,
      callsBeforeUnauthorisedReview
    );

    const evaluationResponse = await app.inject({
      method: "POST",
      url:
        `/revisions/${otherRevisionId}` +
        "/evaluations",
    });

    assert.equal(evaluationResponse.statusCode, 403);
    assert.deepEqual(evaluationResponse.json(), {
      error: "Not permitted to evaluate this revision",
    });

    const unauthorisedRuns = await pool.query(
      `SELECT id
       FROM evaluation_runs
       WHERE draft_revision_id = $1`,
      [otherRevisionId]
    );

    assert.equal(unauthorisedRuns.rowCount, 0);

    // A revision that does not exist gets the same response,
    // so the endpoint cannot be used to probe for valid IDs.
    const missingEvaluationResponse = await app.inject({
      method: "POST",
      url:
        "/revisions/00000000-0000-4000-8000-00000000dead" +
        "/evaluations",
    });

    assert.equal(missingEvaluationResponse.statusCode, 403);
    assert.deepEqual(missingEvaluationResponse.json(), {
      error: "Not permitted to evaluate this revision",
    });
  }
);

test(
  "complete workflow publishes once and exposes only the parent snapshot",
  async () => {

    const childId = "integration-ava";
    const completeDate = "2026-09-20";



    await createObservation(
      childId,
      completeDate,
      "activity",
      "Painted with sponges."
    );

    await createObservation(
      childId,
      completeDate,
      "food",
      "Ate some pasta."
    );

    await createObservation(
      childId,
      completeDate,
      "activity",
      "Listened to a story."
    );

    const draftResponse = await app.inject({
      method: "POST",
      url: "/drafts",
      payload: {
        childId,
        observationDate: completeDate,
        text:
          "Painted with sponges. Ate some pasta. Listened to a story.",
      },
    });

    assert.equal(
      draftResponse.statusCode,
      201,
      draftResponse.body
    );

    const draft = draftResponse.json<{
      draft: {
        id: string;
      };
    }>().draft;

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/revisions/${draft.id}/content-reviews`,
    });

    assert.equal(
      reviewResponse.statusCode,
      201,
      reviewResponse.body
    );

    const review = reviewResponse.json<{
      reviewId: string;
      verdict: string;
      coverage: {
        verdict: string;
        missing: string[];
      };
    }>();

    assert.equal(review.verdict, "supported");
    assert.equal(review.coverage.verdict, "complete");
    assert.deepEqual(review.coverage.missing, []);

    const evaluationResponse = await app.inject({
      method: "POST",
      url: `/revisions/${draft.id}/evaluations`,
    });

    assert.equal(
      evaluationResponse.statusCode,
      201,
      evaluationResponse.body
    );

    const evaluation = evaluationResponse.json<{
      evaluationId: string;
      contentReviewId: string;
      decision: string;
      results: unknown[];
    }>();

    assert.equal(evaluation.decision, "eligible");
    assert.equal(
      evaluation.contentReviewId,
      review.reviewId
    );
    assert.equal(evaluation.results.length, 5);

    const approvalUrl =
      `/evaluation-runs/${evaluation.evaluationId}` +
      "/approval";

    // A practitioner in the right setting can draft and evaluate,
    // but approval is a separate capability.
    const practitionerApproval = await app.inject({
      method: "POST",
      url: approvalUrl,
      headers: asUser(practitionerUserId),
    });

    assert.equal(practitionerApproval.statusCode, 403);
    assert.deepEqual(practitionerApproval.json(), {
      error: "Not permitted to approve this evaluation",
    });

    // Holding the approver role elsewhere grants nothing here.
    const outsideApproval = await app.inject({
      method: "POST",
      url: approvalUrl,
      headers: asUser(outsideApproverUserId),
    });

    assert.equal(outsideApproval.statusCode, 403);
    assert.deepEqual(outsideApproval.json(), {
      error: "Not permitted to approve this evaluation",
    });

    const missingApproval = await app.inject({
      method: "POST",
      url:
        "/evaluation-runs/00000000-0000-4000-8000-00000000dead" +
        "/approval",
    });

    assert.equal(missingApproval.statusCode, 403);
    assert.deepEqual(missingApproval.json(), {
      error: "Not permitted to approve this evaluation",
    });

    // The database refuses the same approvals if a future code
    // path skips the route checks.
    const evaluationRevision = await pool.query<{
      draft_revision_id: string;
    }>(
      `SELECT draft_revision_id
       FROM evaluation_runs
       WHERE id = $1`,
      [evaluation.evaluationId]
    );

    const evaluatedRevisionId =
      evaluationRevision.rows[0]?.draft_revision_id;

    assert.ok(evaluatedRevisionId);

    for (const approvedBy of [
      null,
      practitionerUserId,
      outsideApproverUserId,
    ]) {
      await assert.rejects(
        pool.query(
          `INSERT INTO revision_approvals (
             draft_revision_id,
             evaluation_run_id,
             approved_by
           )
           VALUES ($1, $2, $3)`,
          [
            evaluatedRevisionId,
            evaluation.evaluationId,
            approvedBy,
          ]
        ),
        /must record who approved|not permitted to approve/
      );
    }

    const approvalsBeforeApprover = await pool.query(
      `SELECT id
       FROM revision_approvals
       WHERE evaluation_run_id = $1`,
      [evaluation.evaluationId]
    );

    assert.equal(approvalsBeforeApprover.rowCount, 0);

    const approvalResponse = await app.inject({
      method: "POST",
      url:
        `/evaluation-runs/${evaluation.evaluationId}` +
        "/approval",
    });

    assert.equal(
      approvalResponse.statusCode,
      201,
      approvalResponse.body
    );

    const approval = approvalResponse.json<{
      approval: {
        id: string;
        approved_by: string;
      };
      created: boolean;
    }>();

    assert.equal(approval.created, true);
    assert.equal(
      approval.approval.approved_by,
      integrationUserId
    );

    const approvalRetry = await app.inject({
      method: "POST",
      url:
        `/evaluation-runs/${evaluation.evaluationId}` +
        "/approval",
    });

    assert.equal(
      approvalRetry.statusCode,
      200,
      approvalRetry.body
    );

    assert.equal(
      approvalRetry.json().approval.id,
      approval.approval.id
    );
    assert.equal(
      approvalRetry.json().created,
      false
    );

    const publicationResponse = await app.inject({
      method: "POST",
      url:
        `/revision-approvals/${approval.approval.id}` +
        "/publication",
    });

    assert.equal(
      publicationResponse.statusCode,
      201,
      publicationResponse.body
    );

    const publication = publicationResponse.json<{
      publication: {
        id: string;
      };
      created: boolean;
    }>();

    assert.equal(publication.created, true);

    const publicationRetry = await app.inject({
      method: "POST",
      url:
        `/revision-approvals/${approval.approval.id}` +
        "/publication",
    });

    assert.equal(
      publicationRetry.statusCode,
      200,
      publicationRetry.body
    );

    assert.equal(
      publicationRetry.json().publication.id,
      publication.publication.id
    );
    assert.equal(
      publicationRetry.json().created,
      false
    );

    const parentResponse = await app.inject({
      method: "GET",
      url: `/children/${childId}/published-updates`,
    });

    assert.equal(
      parentResponse.statusCode,
      200,
      parentResponse.body
    );

    const parentUpdates = parentResponse.json<{
      updates: Record<string, unknown>[];
    }>().updates;

    assert.equal(parentUpdates.length, 1);

    assert.deepEqual(
      Object.keys(parentUpdates[0]!).sort(),
      [
        "child_id",
        "id",
        "observation_date",
        "published_at",
        "text",
      ].sort()
    );

    assert.equal(
      parentUpdates[0]!.text,
      "Painted with sponges. Ate some pasta. Listened to a story."
    );
  }
);

test(
  "incomplete coverage cannot be approved",
  async () => {
    const childId = "integration-ava";
    const incompleteDate = "2026-09-21";

    await createObservation(
      childId,
      incompleteDate,
      "activity",
      "Painted with sponges."
    );

    await createObservation(
      childId,
      incompleteDate,
      "food",
      "Ate some pasta."
    );

    const draftResponse = await app.inject({
      method: "POST",
      url: "/drafts",
      payload: {
        childId,
        observationDate: incompleteDate,
        text: "Painted with sponges.",
      },
    });

    assert.equal(
      draftResponse.statusCode,
      201,
      draftResponse.body
    );

    const draftId = draftResponse.json<{
      draft: {
        id: string;
      };
    }>().draft.id;

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/revisions/${draftId}/content-reviews`,
    });

    assert.equal(
      reviewResponse.statusCode,
      201,
      reviewResponse.body
    );

    const review = reviewResponse.json<{
      coverage: {
        verdict: string;
        missing: string[];
      };
    }>();

    assert.equal(
      review.coverage.verdict,
      "incomplete"
    );
    assert.equal(review.coverage.missing.length, 1);

    const evaluationResponse = await app.inject({
      method: "POST",
      url: `/revisions/${draftId}/evaluations`,
    });

    assert.equal(
      evaluationResponse.statusCode,
      201,
      evaluationResponse.body
    );

    const evaluation = evaluationResponse.json<{
      evaluationId: string;
      decision: string;
    }>();

    assert.equal(
      evaluation.decision,
      "needs_review"
    );

    const approvalResponse = await app.inject({
      method: "POST",
      url:
        `/evaluation-runs/${evaluation.evaluationId}` +
        "/approval",
    });

    assert.equal(
      approvalResponse.statusCode,
      409,
      approvalResponse.body
    );
  }
);