CREATE FUNCTION prevent_draft_revision_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Draft revisions cannot be changed or deleted. Create a new revision.';
END;
$$;

CREATE TRIGGER draft_revisions_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE
ON draft_revisions
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_draft_revision_changes();