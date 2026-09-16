-- db/migrations/016_publication_actor.sql
--
-- Publishing sends an update to a family, so it must record who did it.
--
-- As in 015, the column allows existing pre-authentication rows to stay
-- valid history, while the NOT VALID check applies to every new row.
-- published_updates is immutable, so old rows cannot be altered later.

ALTER TABLE published_updates
  ADD COLUMN published_by UUID
    REFERENCES app_users(id);

ALTER TABLE published_updates
  ADD CONSTRAINT published_updates_published_by_required
    CHECK (published_by IS NOT NULL)
    NOT VALID;

CREATE INDEX published_updates_published_by_idx
  ON published_updates (published_by, published_at DESC);


-- Replaces the validation from 012 and adds a publisher check.
--
-- The role list mirrors staffRolesFor("publication:create") in
-- src/authorization.ts. If that mapping changes, change this too.

CREATE OR REPLACE FUNCTION validate_published_update_snapshot()
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
  revision_setting_id TEXT;
BEGIN
  SELECT
    ra.draft_revision_id,
    r.update_id,
    u.child_id,
    u.observation_date,
    r.text,
    r.source_snapshot,
    c.setting_id
  INTO
    approved_revision_id,
    revision_update_id,
    revision_child_id,
    revision_observation_date,
    revision_text,
    revision_sources,
    revision_setting_id
  FROM revision_approvals ra
  JOIN draft_revisions r
    ON r.id = ra.draft_revision_id
  JOIN updates u
    ON u.id = r.update_id
  JOIN children c
    ON c.id = u.child_id
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

  IF NEW.published_by IS NULL THEN
    RAISE EXCEPTION
      'A publication must record who published it.';
  END IF;

  PERFORM 1
  FROM setting_memberships sm
  JOIN app_users au
    ON au.id = sm.user_id
  WHERE sm.setting_id = revision_setting_id
    AND sm.user_id = NEW.published_by
    AND sm.role IN ('approver', 'admin')
    AND au.disabled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The publisher is not permitted to publish for this setting.';
  END IF;

  RETURN NEW;
END;
$$;