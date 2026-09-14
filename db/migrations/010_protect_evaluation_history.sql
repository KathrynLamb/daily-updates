-- Evaluation runs begin in the running state, receive their results, and then
-- make one terminal transition. Finished evidence is immutable.

CREATE FUNCTION enforce_evaluation_run_lifecycle()
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
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Evaluation run identity and evidence bindings cannot be changed.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evaluation_runs_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE
ON evaluation_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_evaluation_run_lifecycle();


CREATE FUNCTION require_running_evaluation_for_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM evaluation_runs
    WHERE id = NEW.evaluation_run_id
      AND status = 'running'
  ) THEN
    RAISE EXCEPTION
      'Evaluation results may only be added to a running evaluation.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evaluation_results_insert_guard
BEFORE INSERT
ON evaluation_results
FOR EACH ROW
EXECUTE FUNCTION require_running_evaluation_for_result();


CREATE FUNCTION prevent_evaluation_result_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Evaluation results cannot be changed or deleted.';
END;
$$;

CREATE TRIGGER evaluation_results_immutable
BEFORE UPDATE OR DELETE
ON evaluation_results
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_evaluation_result_changes();


CREATE FUNCTION prevent_evaluation_history_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Evaluation history cannot be truncated.';
END;
$$;

CREATE TRIGGER evaluation_runs_no_truncate
BEFORE TRUNCATE
ON evaluation_runs
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_evaluation_history_truncate();

CREATE TRIGGER evaluation_results_no_truncate
BEFORE TRUNCATE
ON evaluation_results
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_evaluation_history_truncate();