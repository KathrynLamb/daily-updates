CREATE TABLE updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id TEXT NOT NULL REFERENCES children(id),
  observation_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT updates_child_date_unique
    UNIQUE (child_id, observation_date)
);

CREATE TABLE draft_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id UUID NOT NULL REFERENCES updates(id),
  revision_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  source_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT draft_revisions_number_positive
    CHECK (revision_number >= 1),

  CONSTRAINT draft_revisions_number_unique
    UNIQUE (update_id, revision_number),

  CONSTRAINT draft_revisions_text_not_blank
    CHECK (text ~ '[^[:space:]]'),

  CONSTRAINT draft_revisions_snapshot_is_array
    CHECK (jsonb_typeof(source_snapshot) = 'array')
);