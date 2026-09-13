CREATE TABLE content_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_revision_id UUID NOT NULL REFERENCES draft_revisions(id),

  requested_model TEXT NOT NULL,
  returned_model TEXT,
  rubric_version TEXT NOT NULL,
  rubric_text TEXT NOT NULL,
  input_snapshot JSONB NOT NULL,

  status TEXT NOT NULL DEFAULT 'running',
  verdict TEXT,
  reason TEXT,
  usage JSONB,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CHECK (jsonb_typeof(input_snapshot) = 'object'),
  CHECK (status IN ('running', 'completed', 'error')),
  CHECK (verdict IN ('supported', 'unsupported', 'uncertain')),

  CONSTRAINT content_reviews_state_valid CHECK (
    (
      status = 'running'
      AND verdict IS NULL
      AND completed_at IS NULL
      AND error_message IS NULL
    )
    OR
    (
      status = 'completed'
      AND verdict IS NOT NULL
      AND reason IS NOT NULL
      AND returned_model IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_message IS NULL
    )
    OR
    (
      status = 'error'
      AND verdict IS NULL
      AND error_message IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX content_reviews_revision_idx
  ON content_reviews (draft_revision_id, created_at DESC);