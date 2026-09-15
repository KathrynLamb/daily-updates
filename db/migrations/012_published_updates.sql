-- A published update is an immutable, publish-once snapshot.
-- Parent-facing reads must use this table, never draft_revisions.

CREATE TABLE published_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  update_id UUID NOT NULL
    REFERENCES updates(id),

  draft_revision_id UUID NOT NULL
    REFERENCES draft_revisions(id),

  approval_id UUID NOT NULL
    REFERENCES revision_approvals(id),

  child_id TEXT NOT NULL
    REFERENCES children(id),

  observation_date DATE NOT NULL,

  text_snapshot TEXT NOT NULL,

  source_snapshot JSONB NOT NULL,

  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT published_updates_once_per_update
    UNIQUE (update_id),

  CONSTRAINT published_updates_approval_unique
    UNIQUE (approval_id),

  CONSTRAINT published_updates_revision_unique
    UNIQUE (draft_revision_id),

  CONSTRAINT published_updates_text_not_blank
    CHECK (text_snapshot ~ '[^[:space:]]'),

  CONSTRAINT published_updates_sources_array
    CHECK (jsonb_typeof(source_snapshot) = 'array')
);


CREATE FUNCTION validate_published_update_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approved_revision_id UUID;
  revision_update_id UUID;
  revision_child_id TEXT;
  revision_observation_date DATE;
  revision_text TEXT;
  revision_sources JSONB;
BEGIN
  SELECT
    ra.draft_revision_id,
    r.update_id,
    u.child_id,
    u.observation_date,
    r.text,
    r.source_snapshot
  INTO
    approved_revision_id,
    revision_update_id,
    revision_child_id,
    revision_observation_date,
    revision_text,
    revision_sources
  FROM revision_approvals ra
  JOIN draft_revisions r
    ON r.id = ra.draft_revision_id
  JOIN updates u
    ON u.id = r.update_id
  WHERE ra.id = NEW.approval_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The referenced approval does not exist.';
  END IF;

  IF NEW.draft_revision_id IS DISTINCT FROM approved_revision_id THEN
    RAISE EXCEPTION
      'The publication revision does not match the approval.';
  END IF;

  IF NEW.update_id IS DISTINCT FROM revision_update_id
    OR NEW.child_id IS DISTINCT FROM revision_child_id
    OR NEW.observation_date IS DISTINCT FROM revision_observation_date
    OR NEW.text_snapshot IS DISTINCT FROM revision_text
    OR NEW.source_snapshot IS DISTINCT FROM revision_sources
  THEN
    RAISE EXCEPTION
      'The publication snapshot does not match the approved revision.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER published_updates_snapshot_guard
BEFORE INSERT
ON published_updates
FOR EACH ROW
EXECUTE FUNCTION validate_published_update_snapshot();


CREATE FUNCTION prevent_published_update_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Published updates cannot be changed or deleted.';
END;
$$;

CREATE TRIGGER published_updates_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE
ON published_updates
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_published_update_changes();


CREATE INDEX published_updates_child_date_idx
  ON published_updates (
    child_id,
    observation_date DESC,
    published_at DESC
  );