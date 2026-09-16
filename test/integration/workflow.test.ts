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
import type { DraftGenerator } from "../../src/draft-generator.js";
import type { GenerationInput } from "../../src/generation-schema.js";

let reviewerCallCount = 0;

const inventedIdTrigger = "went on a zoo trip";

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

  // Drafts mentioning this phrase make the fake reviewer cite an
  // observation that was never supplied, as a confused model might.
  const unknown = draft.includes(inventedIdTrigger)
    ? ["invented-observation-id"]
    : [];

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
      unknown,
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

// The fake generator writes every observation into the draft, so the
// fake reviewer finds full coverage. Tests can make it fail, or run
// code while it is "writing" to simulate a concurrent edit.
const generatorCalls: GenerationInput[] = [];

let generatorFailure: Error | null = null;
let whileGenerating: (() => Promise<void>) | null = null;

const fakeGenerator: DraftGenerator = async (input) => {
  generatorCalls.push(input);

  if (whileGenerating) {
    await whileGenerating();
  }

  if (generatorFailure) {
    throw generatorFailure;
  }

  return {
    text: input.observations
      .map((observation) => observation.text)
      .join(" "),
    model: "fake-generation-model",
    promptVersion: "fake-prompt",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
};

function resetGenerator() {
  generatorFailure = null;
  whileGenerating = null;
}

const integrationUserId =
  "00000000-0000-4000-8000-000000000001";

// A same-setting practitioner: may draft, may not approve.
const practitionerUserId =
  "00000000-0000-4000-8000-000000000002";

// An approver, but for a different setting.
const outsideApproverUserId =
  "00000000-0000-4000-8000-000000000003";

// Parents have no setting membership, only explicit child links.
const avaParentUserId =
  "00000000-0000-4000-8000-000000000004";

const otherParentUserId =
  "00000000-0000-4000-8000-000000000005";

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
  generator: fakeGenerator,
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
         ($2::uuid, $3, $2::text),
         ($4::uuid, $3, $4::text),
         ($5::uuid, $3, $5::text)`,
      [
        practitionerUserId,
        outsideApproverUserId,
        "https://identity.example.test",
        avaParentUserId,
        otherParentUserId,
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

    await pool.query(
      `INSERT INTO parent_child_access (
         user_id,
         child_id
       )
       VALUES
         ($1, $2),
         ($3, $4)`,
      [
        avaParentUserId,
        "integration-ava",
        otherParentUserId,
        "other-child",
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
  text: string,
  userId: string = integrationUserId
) {
  const response = await app.inject({
    method: "POST",
    url: "/observations",
    headers: asUser(userId),
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
         source_snapshot,
         created_by
       )
       VALUES ($1, 1, $2, '[]'::jsonb, $3)
       RETURNING id`,
      [
        otherUpdateId,
        "A private draft from another setting.",
        outsideApproverUserId,
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

    const publicationUrl =
      `/revision-approvals/${approval.approval.id}` +
      "/publication";

    // Publishing needs the same role as approving, in this setting.
    for (const userId of [
      practitionerUserId,
      outsideApproverUserId,
      avaParentUserId,
    ]) {
      const refused = await app.inject({
        method: "POST",
        url: publicationUrl,
        headers: asUser(userId),
      });

      assert.equal(refused.statusCode, 403, userId);
      assert.deepEqual(refused.json(), {
        error: "Not permitted to publish this approval",
      });
    }

    const missingPublication = await app.inject({
      method: "POST",
      url:
        "/revision-approvals/00000000-0000-4000-8000-00000000dead" +
        "/publication",
    });

    assert.equal(missingPublication.statusCode, 403);
    assert.deepEqual(missingPublication.json(), {
      error: "Not permitted to publish this approval",
    });

    // The database refuses the same publications directly.
    for (const publishedBy of [
      null,
      practitionerUserId,
      outsideApproverUserId,
      avaParentUserId,
    ]) {
      await assert.rejects(
        pool.query(
          `INSERT INTO published_updates (
             update_id,
             draft_revision_id,
             approval_id,
             child_id,
             observation_date,
             text_snapshot,
             source_snapshot,
             published_by
           )
           SELECT
             r.update_id,
             r.id,
             ra.id,
             u.child_id,
             u.observation_date,
             r.text,
             r.source_snapshot,
             $2::uuid
           FROM revision_approvals ra
           JOIN draft_revisions r
             ON r.id = ra.draft_revision_id
           JOIN updates u
             ON u.id = r.update_id
           WHERE ra.id = $1`,
          [approval.approval.id, publishedBy]
        ),
        /must record who published|not permitted to publish/
      );
    }

    const publicationsBeforePublisher = await pool.query(
      `SELECT id
       FROM published_updates
       WHERE approval_id = $1`,
      [approval.approval.id]
    );

    assert.equal(publicationsBeforePublisher.rowCount, 0);

    const publicationResponse = await app.inject({
      method: "POST",
      url: publicationUrl,
    });

    assert.equal(
      publicationResponse.statusCode,
      201,
      publicationResponse.body
    );

    const publication = publicationResponse.json<{
      publication: {
        id: string;
        published_by: string;
      };
      created: boolean;
    }>();

    assert.equal(publication.created, true);
    assert.equal(
      publication.publication.published_by,
      integrationUserId
    );

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

    const readUrl = `/children/${childId}/published-updates`;

    // Readers: Ava's linked parent, and any staff role in her setting.
    for (const userId of [
      avaParentUserId,
      practitionerUserId,
    ]) {
      const allowed = await app.inject({
        method: "GET",
        url: readUrl,
        headers: asUser(userId),
      });

      assert.equal(allowed.statusCode, 200, userId);
      assert.deepEqual(
        allowed.json().updates,
        parentUpdates
      );
    }

    // Not readers: a parent of another child, and staff elsewhere.
    for (const userId of [
      otherParentUserId,
      outsideApproverUserId,
    ]) {
      const refused = await app.inject({
        method: "GET",
        url: readUrl,
        headers: asUser(userId),
      });

      assert.equal(refused.statusCode, 403, userId);
      assert.deepEqual(refused.json(), {
        error: "Not permitted to read updates for this child",
      });
    }

    // Ava's parent cannot use her link to read another child.
    const crossChildRead = await app.inject({
      method: "GET",
      url: "/children/other-child/published-updates",
      headers: asUser(avaParentUserId),
    });

    assert.equal(crossChildRead.statusCode, 403);

    const missingChildRead = await app.inject({
      method: "GET",
      url: "/children/no-such-child/published-updates",
    });

    assert.equal(missingChildRead.statusCode, 403);
    assert.deepEqual(missingChildRead.json(), {
      error: "Not permitted to read updates for this child",
    });
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
    assert.deepEqual(approvalResponse.json(), {
      error:
        "Only a completed eligible evaluation can be approved",
    });
  }
);

// Creates two observations, a draft covering both, a review and an
// eligible evaluation for one child and date.
async function prepareEligibleEvaluation(observationDate: string) {
  const childId = "integration-ava";

  await createObservation(
    childId,
    observationDate,
    "activity",
    "Built a tower."
  );

  await createObservation(
    childId,
    observationDate,
    "food",
    "Ate some soup."
  );

  const text = "Built a tower. Ate some soup.";

  const draftResponse = await app.inject({
    method: "POST",
    url: "/drafts",
    payload: {
      childId,
      observationDate,
      text,
    },
  });

  assert.equal(draftResponse.statusCode, 201, draftResponse.body);

  const draft = draftResponse.json<{
    draft: {
      id: string;
      update_id: string;
    };
  }>().draft;

  const reviewResponse = await app.inject({
    method: "POST",
    url: `/revisions/${draft.id}/content-reviews`,
  });

  assert.equal(reviewResponse.statusCode, 201, reviewResponse.body);

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
    decision: string;
  }>();

  assert.equal(evaluation.decision, "eligible");

  return {
    childId,
    observationDate,
    text,
    updateId: draft.update_id,
    evaluationId: evaluation.evaluationId,
  };
}

async function approve(evaluationId: string) {
  return app.inject({
    method: "POST",
    url: `/evaluation-runs/${evaluationId}/approval`,
  });
}

async function publish(approvalId: string) {
  return app.inject({
    method: "POST",
    url: `/revision-approvals/${approvalId}/publication`,
  });
}

async function reviseWithoutRefresh(updateId: string, text: string) {
  const response = await app.inject({
    method: "POST",
    url: `/updates/${updateId}/revisions`,
    payload: {
      expectedRevision: 1,
      text,
      refreshSources: false,
    },
  });

  assert.equal(response.statusCode, 201, response.body);
}

async function publicationCountFor(updateId: string) {
  const result = await pool.query(
    `SELECT id
     FROM published_updates
     WHERE update_id = $1`,
    [updateId]
  );

  return result.rowCount;
}

test(
  "approval refuses evidence that changed after evaluation",
  async () => {
    const withNewObservation =
      await prepareEligibleEvaluation("2026-10-01");

    await createObservation(
      withNewObservation.childId,
      withNewObservation.observationDate,
      "sleep",
      "Napped after lunch."
    );

    const staleSources = await approve(
      withNewObservation.evaluationId
    );

    assert.equal(staleSources.statusCode, 409, staleSources.body);
    assert.deepEqual(staleSources.json(), {
      error:
        "The source observations have changed since evaluation",
    });

    const withNewRevision =
      await prepareEligibleEvaluation("2026-10-02");

    await reviseWithoutRefresh(
      withNewRevision.updateId,
      withNewRevision.text
    );

    const staleRevision = await approve(
      withNewRevision.evaluationId
    );

    assert.equal(staleRevision.statusCode, 409, staleRevision.body);
    assert.deepEqual(staleRevision.json(), {
      error:
        "The evaluation is not for the latest draft revision",
    });
  }
);

test(
  "publication refuses evidence that changed after approval",
  async () => {
    const withNewObservation =
      await prepareEligibleEvaluation("2026-10-03");

    const firstApproval = await approve(
      withNewObservation.evaluationId
    );

    assert.equal(
      firstApproval.statusCode,
      201,
      firstApproval.body
    );

    await createObservation(
      withNewObservation.childId,
      withNewObservation.observationDate,
      "sleep",
      "Napped after lunch."
    );

    const staleSources = await publish(
      firstApproval.json().approval.id
    );

    assert.equal(staleSources.statusCode, 409, staleSources.body);
    assert.deepEqual(staleSources.json(), {
      error:
        "The source observations have changed since approval",
    });

    assert.equal(
      await publicationCountFor(withNewObservation.updateId),
      0
    );

    const withNewRevision =
      await prepareEligibleEvaluation("2026-10-04");

    const secondApproval = await approve(
      withNewRevision.evaluationId
    );

    assert.equal(
      secondApproval.statusCode,
      201,
      secondApproval.body
    );

    await reviseWithoutRefresh(
      withNewRevision.updateId,
      withNewRevision.text
    );

    const staleRevision = await publish(
      secondApproval.json().approval.id
    );

    assert.equal(staleRevision.statusCode, 409, staleRevision.body);
    assert.deepEqual(staleRevision.json(), {
      error:
        "The approval is not for the latest draft revision",
    });

    assert.equal(
      await publicationCountFor(withNewRevision.updateId),
      0
    );
  }
);

test(
  "legacy approval without an actor cannot authorise publication",
  async () => {
    const prepared =
      await prepareEligibleEvaluation("2026-10-05");

    const approvalResponse = await approve(
      prepared.evaluationId
    );

    assert.equal(
      approvalResponse.statusCode,
      201,
      approvalResponse.body
    );

    const approvalId = approvalResponse.json<{
      approval: {
        id: string;
        approved_by: string;
      };
    }>().approval.id;

    // A fresh database cannot naturally create an unattributed
    // approval because the current constraint and trigger correctly
    // reject one.
    //
    // To test a real upgrade scenario, temporarily remove those
    // protections and convert this one row into the shape of an
    // approval created before authentication existed.
    //
    // All schema changes happen in one transaction. If any statement
    // fails, rollback restores the original triggers and constraint.
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // The historical table allowed this row before actor tracking
      // existed. Disable user-defined triggers temporarily so the
      // immutable-history trigger does not block our test fixture.
      await client.query(
        `ALTER TABLE revision_approvals
         DISABLE TRIGGER USER`
      );

      // A NOT VALID check still applies to new changes, so it must be
      // removed while the historical test row is reconstructed.
      await client.query(
        `ALTER TABLE revision_approvals
         DROP CONSTRAINT
           revision_approvals_approved_by_required`
      );

      await client.query(
        `UPDATE revision_approvals
         SET approved_by = NULL
         WHERE id = $1`,
        [approvalId]
      );

      // Restore the production constraint in its original form.
      //
      // NOT VALID allows the deliberately historical NULL row to
      // remain, while continuing to reject unattributed new rows.
      await client.query(
        `ALTER TABLE revision_approvals
         ADD CONSTRAINT
           revision_approvals_approved_by_required
         CHECK (approved_by IS NOT NULL)
         NOT VALID`
      );

      await client.query(
        `ALTER TABLE revision_approvals
         ENABLE TRIGGER USER`
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // Confirm that the fixture now genuinely represents an approval
    // retained from before authenticated actors were recorded.
    const historicalApprovals = await pool.query<{
      approved_by: string | null;
    }>(
      `SELECT approved_by
       FROM revision_approvals
       WHERE id = $1`,
      [approvalId]
    );

    assert.equal(
      historicalApprovals.rows[0]?.approved_by,
      null
    );

    // The public API must preserve the historical row but refuse to
    // treat it as authority for a new publication.
    const publicationResponse = await publish(approvalId);

    assert.equal(
      publicationResponse.statusCode,
      409,
      publicationResponse.body
    );

    assert.deepEqual(publicationResponse.json(), {
      error:
        "The approval does not record an authenticated approver",
    });

    // The PostgreSQL trigger must independently reject the same
    // publication. This protects the system if a future route, script,
    // or manual query attempts to bypass the API check.
    await assert.rejects(
      pool.query(
        `INSERT INTO published_updates (
           update_id,
           draft_revision_id,
           approval_id,
           child_id,
           observation_date,
           text_snapshot,
           source_snapshot,
           published_by
         )
         SELECT
           r.update_id,
           r.id,
           ra.id,
           u.child_id,
           u.observation_date,
           r.text,
           r.source_snapshot,
           $2::uuid
         FROM revision_approvals ra
         JOIN draft_revisions r
           ON r.id = ra.draft_revision_id
         JOIN updates u
           ON u.id = r.update_id
         WHERE ra.id = $1`,
        [approvalId, integrationUserId]
      ),
      /does not record who approved/
    );

    assert.equal(
      await publicationCountFor(prepared.updateId),
      0
    );
  }
);

test(
  "a review citing unsupplied observations cannot be approved",
  async () => {
    const childId = "integration-ava";
    const observationDate = "2026-10-06";

    await createObservation(
      childId,
      observationDate,
      "activity",
      "Built a tower."
    );

    // Every supplied observation is covered, so coverage alone would
    // be complete. Only the invented ID stands in the way.
    const draftResponse = await app.inject({
      method: "POST",
      url: "/drafts",
      payload: {
        childId,
        observationDate,
        text: `Built a tower. Also ${inventedIdTrigger}.`,
      },
    });

    assert.equal(draftResponse.statusCode, 201, draftResponse.body);

    const draftId = draftResponse.json<{
      draft: {
        id: string;
      };
    }>().draft.id;

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/revisions/${draftId}/content-reviews`,
    });

    assert.equal(reviewResponse.statusCode, 201, reviewResponse.body);

    const review = reviewResponse.json<{
      coverage: {
        verdict: string;
        unknown: string[];
      };
    }>();

    assert.equal(review.coverage.verdict, "complete");
    assert.deepEqual(review.coverage.unknown, [
      "invented-observation-id",
    ]);

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
      results: {
        ruleId: string;
        outcome: string;
        reason: string;
      }[];
    }>();

    assert.equal(evaluation.decision, "needs_review");

    const coverageResult = evaluation.results.find(
      (result) => result.ruleId === "content_coverage"
    );

    assert.equal(coverageResult?.outcome, "review");
    assert.match(
      coverageResult?.reason ?? "",
      /invented-observation-id/
    );

    const approvalResponse = await approve(evaluation.evaluationId);

    assert.equal(
      approvalResponse.statusCode,
      409,
      approvalResponse.body
    );
    assert.deepEqual(approvalResponse.json(), {
      error:
        "Only a completed eligible evaluation can be approved",
    });
  }
);

test(
  "evidence records who created it",
  async () => {
    const childId = "integration-ava";
    const observationDate = "2026-10-07";
    const practitioner = asUser(practitionerUserId);

    await createObservation(
      childId,
      observationDate,
      "activity",
      "Planted seeds.",
      practitionerUserId
    );

    const draftResponse = await app.inject({
      method: "POST",
      url: "/drafts",
      headers: practitioner,
      payload: {
        childId,
        observationDate,
        text: "Planted seeds.",
      },
    });

    assert.equal(draftResponse.statusCode, 201, draftResponse.body);

    const draft = draftResponse.json<{
      draft: {
        id: string;
        update_id: string;
        created_by: string;
      };
    }>().draft;

    assert.equal(draft.created_by, practitionerUserId);

    // A second revision, saved by a different person.
    const revisionResponse = await app.inject({
      method: "POST",
      url: `/updates/${draft.update_id}/revisions`,
      payload: {
        expectedRevision: 1,
        text: "Planted seeds in the garden.",
        refreshSources: false,
      },
    });

    assert.equal(
      revisionResponse.statusCode,
      201,
      revisionResponse.body
    );

    const revision = revisionResponse.json<{
      draft: {
        id: string;
        created_by: string;
      };
    }>().draft;

    assert.equal(revision.created_by, integrationUserId);

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/revisions/${revision.id}/content-reviews`,
      headers: practitioner,
    });

    assert.equal(reviewResponse.statusCode, 201, reviewResponse.body);

    const evaluationResponse = await app.inject({
      method: "POST",
      url: `/revisions/${revision.id}/evaluations`,
      headers: practitioner,
    });

    assert.equal(
      evaluationResponse.statusCode,
      201,
      evaluationResponse.body
    );

    const actors = await pool.query<{
      observation_by: string;
      first_revision_by: string;
      second_revision_by: string;
      review_by: string;
      evaluation_by: string;
    }>(
      `SELECT
         (SELECT recorded_by
          FROM observations
          WHERE child_id = $1
            AND observation_date = $2) AS observation_by,
         (SELECT created_by
          FROM draft_revisions
          WHERE id = $3) AS first_revision_by,
         (SELECT created_by
          FROM draft_revisions
          WHERE id = $4) AS second_revision_by,
         (SELECT requested_by
          FROM content_reviews
          WHERE draft_revision_id = $4) AS review_by,
         (SELECT requested_by
          FROM evaluation_runs
          WHERE draft_revision_id = $4) AS evaluation_by`,
      [childId, observationDate, draft.id, revision.id]
    );

    assert.deepEqual(actors.rows[0], {
      observation_by: practitionerUserId,
      first_revision_by: practitionerUserId,
      second_revision_by: integrationUserId,
      review_by: practitionerUserId,
      evaluation_by: practitionerUserId,
    });

    // Finishing a review or evaluation cannot rewrite who asked for it.
    for (const table of ["content_reviews", "evaluation_runs"]) {
      await assert.rejects(
        pool.query(
          `UPDATE ${table}
           SET requested_by = $1
           WHERE draft_revision_id = $2`,
          [integrationUserId, revision.id]
        ),
        /cannot be changed/,
        table
      );
    }

    // New evidence without an author is refused by the database.
    await assert.rejects(
      pool.query(
        `INSERT INTO observations (
           child_id,
           observation_date,
           category,
           text
         )
         VALUES ($1, $2, 'general', 'Unattributed.')`,
        [childId, observationDate]
      ),
      /observations_recorded_by_required/
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO draft_revisions (
           update_id,
           revision_number,
           text,
           source_snapshot
         )
         VALUES ($1, 3, 'Unattributed.', '[]'::jsonb)`,
        [draft.update_id]
      ),
      /draft_revisions_created_by_required/
    );
  }
);
type GeneratedDraft = {
  generationId: string;
  draft: {
    id: string;
    update_id: string;
    revision_number: number;
    text: string;
    source_snapshot: { id: string }[];
    created_by: string;
    generation_id: string;
  };
};

async function generateFirstDraft(
  childId: string,
  observationDate: string,
  userId: string = practitionerUserId
) {
  return app.inject({
    method: "POST",
    url: "/drafts/generate",
    headers: asUser(userId),
    payload: {
      childId,
      observationDate,
    },
  });
}

async function regenerate(
  updateId: string,
  expectedRevision: number,
  userId: string = practitionerUserId
) {
  return app.inject({
    method: "POST",
    url: `/updates/${updateId}/generations`,
    headers: asUser(userId),
    payload: {
      expectedRevision,
    },
  });
}

async function generationRow(generationId: string) {
  const rows = await pool.query<{
    status: string;
    child_id: string;
    update_id: string | null;
    requested_by: string;
    requested_model: string;
    returned_model: string | null;
    prompt_version: string;
    output_text: string | null;
    error_message: string | null;
    input_snapshot: GenerationInput;
    source_snapshot: { id: string }[];
  }>(
    `SELECT
       status,
       child_id,
       update_id,
       requested_by,
       requested_model,
       returned_model,
       prompt_version,
       output_text,
       error_message,
       input_snapshot,
       source_snapshot
     FROM draft_generations
     WHERE id = $1`,
    [generationId]
  );

  const row = rows.rows[0];
  assert.ok(row, `No generation ${generationId}`);
  return row;
}

test(
  "a Claude-written draft goes through review, approval and publication",
  async () => {
    resetGenerator();

    const childId = "integration-ava";
    const observationDate = "2026-10-08";

    await createObservation(
      childId,
      observationDate,
      "activity",
      "Painted a rainbow.",
      practitionerUserId
    );

    await createObservation(
      childId,
      observationDate,
      "food",
      "Ate all of her fish pie.",
      practitionerUserId
    );

    const callsBefore = generatorCalls.length;
    const response = await generateFirstDraft(childId, observationDate);

    assert.equal(response.statusCode, 201, response.body);

    const { generationId, draft } = response.json<GeneratedDraft>();

    assert.equal(generatorCalls.length, callsBefore + 1);

    // The model is given the child's first name, the date and the
    // observations, and nothing else.
    const input = generatorCalls.at(-1);

    assert.ok(input);
    assert.deepEqual(Object.keys(input).sort(), [
      "childName",
      "observationDate",
      "observations",
    ]);
    assert.equal(input.childName, "Ava");
    assert.equal(input.observationDate, observationDate);
    assert.deepEqual(
      input.observations.map((observation) => observation.text),
      ["Painted a rainbow.", "Ate all of her fish pie."]
    );

    assert.equal(draft.revision_number, 1);
    assert.equal(
      draft.text,
      "Painted a rainbow. Ate all of her fish pie."
    );
    assert.equal(draft.generation_id, generationId);
    assert.equal(draft.created_by, practitionerUserId);

    const generation = await generationRow(generationId);

    assert.equal(generation.status, "completed");
    assert.equal(generation.update_id, null);
    assert.equal(generation.requested_by, practitionerUserId);
    assert.equal(generation.returned_model, "fake-generation-model");
    assert.equal(generation.output_text, draft.text);
    assert.deepEqual(generation.input_snapshot, input);
    assert.deepEqual(
      generation.source_snapshot,
      draft.source_snapshot
    );

    // From here the generated draft is treated like any other.
    const reviewResponse = await app.inject({
      method: "POST",
      url: `/revisions/${draft.id}/content-reviews`,
      headers: asUser(practitionerUserId),
    });

    assert.equal(reviewResponse.statusCode, 201, reviewResponse.body);

    const evaluationResponse = await app.inject({
      method: "POST",
      url: `/revisions/${draft.id}/evaluations`,
      headers: asUser(practitionerUserId),
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

    assert.equal(evaluation.decision, "eligible");

    const approvalResponse = await approve(evaluation.evaluationId);

    assert.equal(
      approvalResponse.statusCode,
      201,
      approvalResponse.body
    );

    const publicationResponse = await publish(
      approvalResponse.json().approval.id
    );

    assert.equal(
      publicationResponse.statusCode,
      201,
      publicationResponse.body
    );

    const parentRead = await app.inject({
      method: "GET",
      url: `/children/${childId}/published-updates`,
      headers: asUser(avaParentUserId),
    });

    assert.equal(parentRead.statusCode, 200, parentRead.body);
    assert.ok(
      parentRead
        .json<{ updates: { text: string }[] }>()
        .updates.some((update) => update.text === draft.text)
    );
  }
);

test(
  "a failed generation is recorded and saves no draft",
  async () => {
    resetGenerator();
    generatorFailure = new TypeError("Model unavailable");

    const childId = "integration-ava";
    const observationDate = "2026-10-09";

    await createObservation(
      childId,
      observationDate,
      "sleep",
      "Slept for an hour."
    );

    const response = await generateFirstDraft(childId, observationDate);

    assert.equal(response.statusCode, 502, response.body);

    const { generationId } = response.json<{
      generationId: string;
    }>();

    assert.deepEqual(response.json(), {
      error: "Draft generation failed",
      generationId,
    });

    const generation = await generationRow(generationId);

    assert.equal(generation.status, "error");
    assert.equal(generation.output_text, null);

    // Only the error category is stored, never the error text.
    assert.equal(
      generation.error_message,
      "Generation failed (TypeError)"
    );

    const updates = await pool.query(
      `SELECT id
       FROM updates
       WHERE child_id = $1
         AND observation_date = $2`,
      [childId, observationDate]
    );

    assert.equal(updates.rowCount, 0);

    // The failure does not block a later attempt.
    resetGenerator();

    const retry = await generateFirstDraft(childId, observationDate);

    assert.equal(retry.statusCode, 201, retry.body);
  }
);

test(
  "generation is refused before the model is called",
  async () => {
    resetGenerator();

    const callsBefore = generatorCalls.length;

    await pool.query(
      `INSERT INTO observations (
         child_id,
         observation_date,
         category,
         text,
         recorded_by
       )
       VALUES ($1, $2, 'activity', 'Played outside.', $3)`,
      ["other-child", "2026-10-10", outsideApproverUserId]
    );

    // A date that already has a hand-written draft.
    await createObservation(
      "integration-ava",
      "2026-10-14",
      "activity",
      "Read a book."
    );

    const existingDraft = await app.inject({
      method: "POST",
      url: "/drafts",
      payload: {
        childId: "integration-ava",
        observationDate: "2026-10-14",
        text: "Read a book.",
      },
    });

    assert.equal(existingDraft.statusCode, 201, existingDraft.body);

    const refusals: [
      string,
      Awaited<ReturnType<typeof app.inject>>,
      number,
    ][] = [
      [
        "another setting's child",
        await generateFirstDraft("other-child", "2026-10-10"),
        403,
      ],
      [
        "a child that does not exist",
        await generateFirstDraft("no-such-child", "2026-10-10"),
        403,
      ],
      [
        "a parent",
        await generateFirstDraft(
          "integration-ava",
          "2026-10-10",
          avaParentUserId
        ),
        403,
      ],
      [
        "a date that already has an update",
        await generateFirstDraft("integration-ava", "2026-10-14"),
        409,
      ],
      [
        "a date with no observations",
        await generateFirstDraft("integration-ava", "2026-10-11"),
        400,
      ],
    ];

    for (const [name, response, statusCode] of refusals) {
      assert.equal(response.statusCode, statusCode, name);
    }

    const otherUpdate = await pool.query<{ id: string }>(
      `SELECT id
       FROM updates
       WHERE child_id = 'other-child'
       LIMIT 1`
    );

    const otherUpdateId = otherUpdate.rows[0]?.id;
    assert.ok(otherUpdateId);

    const otherRegeneration = await regenerate(otherUpdateId, 1);

    assert.equal(otherRegeneration.statusCode, 403);
    assert.deepEqual(otherRegeneration.json(), {
      error: "Not permitted to revise this update",
    });

    const missingRegeneration = await regenerate(
      "00000000-0000-4000-8000-00000000dead",
      1
    );

    assert.equal(missingRegeneration.statusCode, 403);

    // Nothing was sent to the model and nothing was recorded.
    assert.equal(generatorCalls.length, callsBefore);

    const otherGenerations = await pool.query(
      `SELECT id
       FROM draft_generations
       WHERE child_id <> 'integration-ava'
          OR observation_date IN ('2026-10-10', '2026-10-11')`
    );

    assert.equal(otherGenerations.rowCount, 0);
  }
);

test(
  "regeneration uses current observations and never overwrites an edit",
  async () => {
    resetGenerator();

    const childId = "integration-ava";
    const observationDate = "2026-10-12";

    await createObservation(
      childId,
      observationDate,
      "activity",
      "Built a den."
    );

    const first = await generateFirstDraft(childId, observationDate);

    assert.equal(first.statusCode, 201, first.body);

    const updateId = first.json<GeneratedDraft>().draft.update_id;

    await createObservation(
      childId,
      observationDate,
      "food",
      "Ate some apple."
    );

    const second = await regenerate(updateId, 1);

    assert.equal(second.statusCode, 201, second.body);

    const regenerated = second.json<GeneratedDraft>();

    assert.equal(regenerated.draft.revision_number, 2);
    assert.equal(
      regenerated.draft.text,
      "Built a den. Ate some apple."
    );
    assert.equal(regenerated.draft.source_snapshot.length, 2);
    assert.equal(
      (await generationRow(regenerated.generationId)).update_id,
      updateId
    );

    // A stale request is refused without calling the model.
    const callsBefore = generatorCalls.length;
    const stale = await regenerate(updateId, 1);

    assert.equal(stale.statusCode, 409, stale.body);
    assert.deepEqual(stale.json(), {
      error: "This draft has changed. Load the latest revision.",
      currentRevision: 2,
    });
    assert.equal(generatorCalls.length, callsBefore);

    // Someone saves an edit while the model is writing. Their edit
    // stands, and the generated text is kept only as history.
    whileGenerating = async () => {
      whileGenerating = null;

      const edit = await app.inject({
        method: "POST",
        url: `/updates/${updateId}/revisions`,
        payload: {
          expectedRevision: 2,
          text: "Built a den and ate some apple.",
          refreshSources: false,
        },
      });

      assert.equal(edit.statusCode, 201, edit.body);
    };

    const raced = await regenerate(updateId, 2);

    assert.equal(raced.statusCode, 409, raced.body);

    const racedBody = raced.json<{
      currentRevision: number;
      generationId: string;
    }>();

    assert.equal(racedBody.currentRevision, 3);
    assert.equal(
      (await generationRow(racedBody.generationId)).status,
      "completed"
    );

    const latest = await pool.query<{
      revision_number: number;
      text: string;
      generation_id: string | null;
    }>(
      `SELECT revision_number, text, generation_id
       FROM draft_revisions
       WHERE update_id = $1
       ORDER BY revision_number DESC
       LIMIT 1`,
      [updateId]
    );

    assert.deepEqual(latest.rows[0], {
      revision_number: 3,
      text: "Built a den and ate some apple.",
      generation_id: null,
    });
  }
);

test(
  "the database only links a revision to a matching generation",
  async () => {
    resetGenerator();

    const childId = "integration-ava";
    const observationDate = "2026-10-13";

    await createObservation(
      childId,
      observationDate,
      "general",
      "Waved goodbye."
    );

    const first = await generateFirstDraft(childId, observationDate);

    assert.equal(first.statusCode, 201, first.body);

    const { draft } = first.json<GeneratedDraft>();

    // Produce a completed generation that was never saved, by editing
    // the draft while the model is writing.
    whileGenerating = async () => {
      whileGenerating = null;

      const edit = await app.inject({
        method: "POST",
        url: `/updates/${draft.update_id}/revisions`,
        headers: asUser(practitionerUserId),
        payload: {
          expectedRevision: 1,
          text: "Waved goodbye at home time.",
          refreshSources: false,
        },
      });

      assert.equal(edit.statusCode, 201, edit.body);
    };

    const raced = await regenerate(draft.update_id, 1);

    assert.equal(raced.statusCode, 409, raced.body);

    const unusedId = raced.json<{ generationId: string }>().generationId;
    const unused = await generationRow(unusedId);

    const insertRevision = (
      text: string | null,
      createdBy: string,
      generationId: string
    ) =>
      pool.query(
        `INSERT INTO draft_revisions (
           update_id,
           revision_number,
           text,
           source_snapshot,
           created_by,
           generation_id
         )
         SELECT
           $1,
           3,
           COALESCE($2, g.output_text),
           g.source_snapshot,
           $3,
           g.id
         FROM draft_generations g
         WHERE g.id = $4`,
        [draft.update_id, text, createdBy, generationId]
      );

    await assert.rejects(
      insertRevision(
        "Waved goodbye and cried.",
        practitionerUserId,
        unusedId
      ),
      /must match the generation exactly/
    );

    await assert.rejects(
      insertRevision(null, integrationUserId, unusedId),
      /saved by whoever requested it/
    );

    // A generation already used for revision 1 cannot be reused.
    await assert.rejects(
      insertRevision(
        null,
        practitionerUserId,
        draft.generation_id
      ),
      /draft_revisions_generation_unique/
    );

    // A failed generation cannot produce a revision.
    generatorFailure = new Error("Model unavailable");

    const failedResponse = await regenerate(draft.update_id, 2);

    assert.equal(failedResponse.statusCode, 502, failedResponse.body);
    resetGenerator();

    const failedId = failedResponse.json<{
      generationId: string;
    }>().generationId;

    await assert.rejects(
      pool.query(
        `INSERT INTO draft_revisions (
           update_id,
           revision_number,
           text,
           source_snapshot,
           created_by,
           generation_id
         )
         VALUES ($1, 3, 'Anything.', '[]'::jsonb, $2, $3)`,
        [draft.update_id, practitionerUserId, failedId]
      ),
      /Only a completed draft generation/
    );

    // Generation history cannot be rewritten or removed.
    await assert.rejects(
      pool.query(
        `UPDATE draft_generations
         SET output_text = 'Something else.'
         WHERE id = $1`,
        [unusedId]
      ),
      /Finished draft generations cannot be changed/
    );

    await assert.rejects(
      pool.query(
        `DELETE FROM draft_generations
         WHERE id = $1`,
        [unusedId]
      ),
      /cannot be deleted/
    );

    // The correctly matching revision is accepted.
    assert.equal(unused.requested_by, practitionerUserId);

    const accepted = await insertRevision(
      null,
      practitionerUserId,
      unusedId
    );

    assert.equal(accepted.rowCount, 1);
  }
);