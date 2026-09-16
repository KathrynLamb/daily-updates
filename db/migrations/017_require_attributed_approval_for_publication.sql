-- db/migrations/017_require_attributed_approval_for_publication.sql
--
-- Approvals created before actor tracking was introduced may have
-- approved_by = NULL. Those rows remain valid historical records,
-- but they must not authorise a new publication.
--
-- This replaces the publication validation function from migration
-- 016. The existing trigger continues to call the replaced function.

CREATE OR REPLACE FUNCTION validate_published_update_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approved_revision_id UUID;
  approval_actor_id UUID;
  revision_update_id UUID;
  revision_child_id TEXT;
  revision_observation_date DATE;
  revision_text TEXT;
  revision_sources JSONB;
  revision_setting_id TEXT;
BEGIN
  SELECT
    ra.draft_revision_id,
    ra.approved_by,
    r.update_id,
    u.child_id,
    u.observation_date,
    r.text,
    r.source_snapshot,
    c.setting_id
  INTO
    approved_revision_id,
    approval_actor_id,
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

  -- Historical approvals remain stored, but an approval without an
  -- authenticated actor is not sufficient authority for a new
  -- publication.
  IF approval_actor_id IS NULL THEN
    RAISE EXCEPTION
      'The approval does not record who approved it.';
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

  -- The person publishing must currently be an active approver or
  -- administrator in the child's setting.
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
