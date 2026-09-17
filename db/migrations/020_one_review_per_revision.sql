-- db/migrations/020_one_review_per_revision.sql
--
-- Claude's review is the only part of the checks that can give a
-- different answer when repeated. If a draft version could be reviewed
-- again and again, someone could keep asking until a review happened to
-- pass, and then approve that one.
--
-- So each draft version gets one review under the current reviewer
-- settings (model, rubric version and rubric text). A review that failed
-- with an error does not count, so it can be retried. To check again
-- after a review, the draft has to change, which creates a new version.
--
-- A trigger is used rather than a unique index so that any repeat
-- reviews recorded before this rule existed remain valid history.

CREATE FUNCTION enforce_one_review_per_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialises review requests for the same draft version, so two
  -- requests arriving together cannot both pass the check below.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('content_review:' || NEW.draft_revision_id::text, 0)
  );

  PERFORM 1
  FROM content_reviews
  WHERE draft_revision_id = NEW.draft_revision_id
    AND requested_model = NEW.requested_model
    AND rubric_version = NEW.rubric_version
    AND rubric_text = NEW.rubric_text
    AND status IN ('running', 'completed');

  IF FOUND THEN
    RAISE EXCEPTION
      'This draft version has already been reviewed.'
      USING ERRCODE = 'unique_violation',
            CONSTRAINT = 'content_reviews_one_per_revision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER content_reviews_one_per_revision
BEFORE INSERT
ON content_reviews
FOR EACH ROW
EXECUTE FUNCTION enforce_one_review_per_revision();
