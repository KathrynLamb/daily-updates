-- db/migrations/015_approval_actor.sql
--
-- An approval is a human decision, so it must record who made it.
--
-- The column is added without NOT NULL so that any approvals created
-- before authentication existed remain valid history. The NOT VALID
-- check applies to every new row without rewriting or rejecting the
-- old ones. revision_approvals is immutable, so no existing row can
-- later be updated into a state that bypasses this.

ALTER TABLE revision_approvals
  ADD COLUMN approved_by UUID
    REFERENCES app_users(id);

ALTER TABLE revision_approvals
  ADD CONSTRAINT revision_approvals_approved_by_required
    CHECK (approved_by IS NOT NULL)
    NOT VALID;

CREATE INDEX revision_approvals_approved_by_idx
  ON revision_approvals (approved_by, approved_at DESC);


-- Replaces the validation from 011 and adds an approver check.
--
-- The API already enforces this. The trigger is a backstop so that
-- a future route, script or manual insert cannot record an approval
-- from someone who was not entitled to give it.
--
-- The role list mirrors staffRolesFor("approval:create") in
-- src/authorization.ts. If that mapping changes, change this too.

CREATE OR REPLACE FUNCTION validate_revision_approval()
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

  IF NEW.approved_by IS NULL THEN
    RAISE EXCEPTION
      'An approval must record who approved it.';
  END IF;

  PERFORM 1
  FROM draft_revisions r
  JOIN updates u
    ON u.id = r.update_id
  JOIN children c
    ON c.id = u.child_id
  JOIN setting_memberships sm
    ON sm.setting_id = c.setting_id
  JOIN app_users au
    ON au.id = sm.user_id
  WHERE r.id = NEW.draft_revision_id
    AND sm.user_id = NEW.approved_by
    AND sm.role IN ('approver', 'admin')
    AND au.disabled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The approver is not permitted to approve for this setting.';
  END IF;

  RETURN NEW;
END;
$$;