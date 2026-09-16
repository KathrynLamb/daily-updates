-- db/migrations/018_evidence_actors.sql
--
-- Approvals and publications already record who made them. This
-- migration does the same for the evidence behind them:
--
--   observations.recorded_by        who recorded the observation
--   draft_revisions.created_by      who wrote or saved the revision
--   content_reviews.requested_by    who asked for the AI review
--   evaluation_runs.requested_by    who asked for the evaluation
--
-- As in 015 and 016, existing rows from before authentication stay
-- valid history, while NOT VALID checks require an actor on every new
-- row. The API checks access; these columns record the result.

ALTER TABLE observations
  ADD COLUMN recorded_by UUID
    REFERENCES app_users(id);

ALTER TABLE observations
  ADD CONSTRAINT observations_recorded_by_required
    CHECK (recorded_by IS NOT NULL)
    NOT VALID;

CREATE INDEX observations_recorded_by_idx
  ON observations (recorded_by);


ALTER TABLE draft_revisions
  ADD COLUMN created_by UUID
    REFERENCES app_users(id);

ALTER TABLE draft_revisions
  ADD CONSTRAINT draft_revisions_created_by_required
    CHECK (created_by IS NOT NULL)
    NOT VALID;

CREATE INDEX draft_revisions_created_by_idx
  ON draft_revisions (created_by);


ALTER TABLE content_reviews
  ADD COLUMN requested_by UUID
    REFERENCES app_users(id);

ALTER TABLE content_reviews
  ADD CONSTRAINT content_reviews_requested_by_required
    CHECK (requested_by IS NOT NULL)
    NOT VALID;

CREATE INDEX content_reviews_requested_by_idx
  ON content_reviews (requested_by);


ALTER TABLE evaluation_runs
  ADD COLUMN requested_by UUID
    REFERENCES app_users(id);

ALTER TABLE evaluation_runs
  ADD CONSTRAINT evaluation_runs_requested_by_required
    CHECK (requested_by IS NOT NULL)
    NOT VALID;

CREATE INDEX evaluation_runs_requested_by_idx
  ON evaluation_runs (requested_by);


-- Draft revisions are already fully immutable (migration 006).
-- Content reviews and evaluation runs are updated once, when they
-- finish, so their lifecycle guards are replaced to stop that update
-- from rewriting who requested them. Everything else is unchanged
-- from migrations 010 and 013.

CREATE OR REPLACE FUNCTION enforce_evaluation_run_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' THEN
      RAISE EXCEPTION
        'Evaluation runs must be created in the running state.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Evaluation runs cannot be deleted.';
  END IF;

  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION
      'Finished evaluation runs cannot be changed.';
  END IF;

  IF NEW.status NOT IN ('completed', 'error') THEN
    RAISE EXCEPTION
      'A running evaluation may only transition to completed or error.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.draft_revision_id IS DISTINCT FROM OLD.draft_revision_id
    OR NEW.evaluator_version IS DISTINCT FROM OLD.evaluator_version
    OR NEW.rules_snapshot IS DISTINCT FROM OLD.rules_snapshot
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.content_review_id IS DISTINCT FROM OLD.content_review_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Evaluation run identity and evidence bindings cannot be changed.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_content_review_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' THEN
      RAISE EXCEPTION
        'Content reviews must be created in the running state.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Content reviews cannot be deleted.';
  END IF;

  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION
      'Finished content reviews cannot be changed.';
  END IF;

  IF NEW.status NOT IN ('completed', 'error') THEN
    RAISE EXCEPTION
      'A running content review may only transition to completed or error.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.draft_revision_id IS DISTINCT FROM OLD.draft_revision_id
    OR NEW.requested_model IS DISTINCT FROM OLD.requested_model
    OR NEW.rubric_version IS DISTINCT FROM OLD.rubric_version
    OR NEW.rubric_text IS DISTINCT FROM OLD.rubric_text
    OR NEW.input_snapshot IS DISTINCT FROM OLD.input_snapshot
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Content review identity and input bindings cannot be changed.';
  END IF;

  RETURN NEW;
END;
$$;