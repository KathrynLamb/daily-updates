-- db/migrations/019_draft_generations.sql
--
-- Records every attempt to have Claude write a draft, and links each
-- generated revision to the attempt that produced it.
--
-- A generation is created as running before the model is called, then
-- makes one transition to completed or error. Its inputs never change.
-- A revision that claims to be generated must contain exactly what the
-- model wrote, from exactly the observations the model was given.

CREATE TABLE draft_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  child_id TEXT NOT NULL
    REFERENCES children(id),
  observation_date DATE NOT NULL,

  -- NULL when generating the first draft, before the update exists.
  update_id UUID
    REFERENCES updates(id),

  requested_by UUID NOT NULL
    REFERENCES app_users(id),

  requested_model TEXT NOT NULL,
  returned_model TEXT,
  prompt_version TEXT NOT NULL,
  prompt_text TEXT NOT NULL,

  -- Exactly what the model was sent.
  input_snapshot JSONB NOT NULL,

  -- The observation rows the draft is based on, in the same shape as
  -- draft_revisions.source_snapshot.
  source_snapshot JSONB NOT NULL,

  status TEXT NOT NULL DEFAULT 'running',
  output_text TEXT,
  usage JSONB,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT draft_generations_input_is_object
    CHECK (jsonb_typeof(input_snapshot) = 'object'),

  CONSTRAINT draft_generations_sources_not_empty
    CHECK (
      jsonb_typeof(source_snapshot) = 'array'
      AND jsonb_array_length(source_snapshot) > 0
    ),

  CONSTRAINT draft_generations_status_valid
    CHECK (status IN ('running', 'completed', 'error')),

  CONSTRAINT draft_generations_state_valid CHECK (
    (
      status = 'running'
      AND output_text IS NULL
      AND returned_model IS NULL
      AND error_message IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      status = 'completed'
      AND output_text ~ '[^[:space:]]'
      AND returned_model IS NOT NULL
      AND error_message IS NULL
      AND completed_at IS NOT NULL
    )
    OR
    (
      status = 'error'
      AND output_text IS NULL
      AND error_message IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX draft_generations_child_date_idx
  ON draft_generations (child_id, observation_date, created_at DESC);

CREATE INDEX draft_generations_requested_by_idx
  ON draft_generations (requested_by);


CREATE FUNCTION enforce_draft_generation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' THEN
      RAISE EXCEPTION
        'Draft generations must be created in the running state.';
    END IF;

    IF NEW.update_id IS NOT NULL THEN
      PERFORM 1
      FROM updates u
      WHERE u.id = NEW.update_id
        AND u.child_id = NEW.child_id
        AND u.observation_date = NEW.observation_date;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'The generation child and date do not match its update.';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Draft generations cannot be deleted.';
  END IF;

  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION
      'Finished draft generations cannot be changed.';
  END IF;

  IF NEW.status NOT IN ('completed', 'error') THEN
    RAISE EXCEPTION
      'A running draft generation may only transition to completed or error.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.child_id IS DISTINCT FROM OLD.child_id
    OR NEW.observation_date IS DISTINCT FROM OLD.observation_date
    OR NEW.update_id IS DISTINCT FROM OLD.update_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_model IS DISTINCT FROM OLD.requested_model
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.prompt_text IS DISTINCT FROM OLD.prompt_text
    OR NEW.input_snapshot IS DISTINCT FROM OLD.input_snapshot
    OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Draft generation identity and inputs cannot be changed.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER draft_generations_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE
ON draft_generations
FOR EACH ROW
EXECUTE FUNCTION enforce_draft_generation_lifecycle();

CREATE FUNCTION prevent_draft_generation_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Draft generation history cannot be truncated.';
END;
$$;

CREATE TRIGGER draft_generations_no_truncate
BEFORE TRUNCATE
ON draft_generations
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_draft_generation_truncate();


-- A generation can produce at most one revision.

ALTER TABLE draft_revisions
  ADD COLUMN generation_id UUID
    REFERENCES draft_generations(id);

ALTER TABLE draft_revisions
  ADD CONSTRAINT draft_revisions_generation_unique
    UNIQUE (generation_id);


CREATE FUNCTION validate_generated_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  generation draft_generations%ROWTYPE;
  revision_child_id TEXT;
  revision_observation_date DATE;
BEGIN
  IF NEW.generation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO generation
  FROM draft_generations
  WHERE id = NEW.generation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The referenced draft generation does not exist.';
  END IF;

  IF generation.status <> 'completed' THEN
    RAISE EXCEPTION
      'Only a completed draft generation can produce a revision.';
  END IF;

  SELECT child_id, observation_date
  INTO revision_child_id, revision_observation_date
  FROM updates
  WHERE id = NEW.update_id;

  IF revision_child_id IS DISTINCT FROM generation.child_id
    OR revision_observation_date IS DISTINCT FROM generation.observation_date
    OR (
      generation.update_id IS NOT NULL
      AND generation.update_id IS DISTINCT FROM NEW.update_id
    )
  THEN
    RAISE EXCEPTION
      'The generated revision belongs to a different update.';
  END IF;

  IF NEW.text IS DISTINCT FROM generation.output_text
    OR NEW.source_snapshot IS DISTINCT FROM generation.source_snapshot
  THEN
    RAISE EXCEPTION
      'A generated revision must match the generation exactly.';
  END IF;

  IF NEW.created_by IS DISTINCT FROM generation.requested_by THEN
    RAISE EXCEPTION
      'A generated revision must be saved by whoever requested it.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER draft_revisions_generation_guard
BEFORE INSERT
ON draft_revisions
FOR EACH ROW
EXECUTE FUNCTION validate_generated_revision();