-- Content reviews begin as running and make one terminal transition.
-- Their inputs and completed evidence are immutable afterward.

CREATE FUNCTION enforce_content_review_lifecycle()
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
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Content review identity and input bindings cannot be changed.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER content_reviews_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE
ON content_reviews
FOR EACH ROW
EXECUTE FUNCTION enforce_content_review_lifecycle();


CREATE FUNCTION prevent_content_review_history_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Content review history cannot be truncated.';
END;
$$;

CREATE TRIGGER content_reviews_no_truncate
BEFORE TRUNCATE
ON content_reviews
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_content_review_history_truncate();