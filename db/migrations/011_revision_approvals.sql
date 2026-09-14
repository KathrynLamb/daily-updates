-- An approval records that one exact immutable evaluation authorized one exact
-- immutable draft revision. Currentness checks remain the API's responsibility.

CREATE TABLE revision_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_revision_id UUID NOT NULL
    REFERENCES draft_revisions(id),
  evaluation_run_id UUID NOT NULL
    REFERENCES evaluation_runs(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT revision_approvals_evaluation_unique
    UNIQUE (evaluation_run_id)
);

CREATE INDEX revision_approvals_revision_idx
  ON revision_approvals (draft_revision_id, approved_at DESC);


CREATE FUNCTION validate_revision_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluated_revision_id UUID;
  evaluation_status TEXT;
  evaluation_decision TEXT;
BEGIN
  SELECT
    draft_revision_id,
    status,
    decision
  INTO
    evaluated_revision_id,
    evaluation_status,
    evaluation_decision
  FROM evaluation_runs
  WHERE id = NEW.evaluation_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The referenced evaluation run does not exist.';
  END IF;

  IF evaluated_revision_id IS DISTINCT FROM NEW.draft_revision_id THEN
    RAISE EXCEPTION
      'The evaluation run does not belong to this draft revision.';
  END IF;

  IF evaluation_status <> 'completed'
    OR evaluation_decision <> 'eligible'
  THEN
    RAISE EXCEPTION
      'Only a completed eligible evaluation can be approved.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER revision_approvals_validation
BEFORE INSERT
ON revision_approvals
FOR EACH ROW
EXECUTE FUNCTION validate_revision_approval();


CREATE FUNCTION prevent_revision_approval_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Revision approvals cannot be changed or deleted.';
END;
$$;

CREATE TRIGGER revision_approvals_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE
ON revision_approvals
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_revision_approval_changes();