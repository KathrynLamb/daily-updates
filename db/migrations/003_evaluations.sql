CREATE TABLE evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_revision_id UUID NOT NULL REFERENCES draft_revisions(id),
  evaluator_version TEXT NOT NULL,
  rules_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT evaluation_runs_status_valid
    CHECK (status IN ('running', 'completed', 'error')),

  CONSTRAINT evaluation_runs_decision_valid
    CHECK (decision IN ('eligible', 'needs_review', 'blocked')),

  CONSTRAINT evaluation_runs_rules_object
    CHECK (jsonb_typeof(rules_snapshot) = 'object'),

  CONSTRAINT evaluation_runs_completion_valid
    CHECK (
      (
        status = 'running'
        AND decision IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        status = 'completed'
        AND decision IS NOT NULL
        AND completed_at IS NOT NULL
      )
      OR
      (
        status = 'error'
        AND decision IS NULL
        AND completed_at IS NOT NULL
      )
    )
);

CREATE TABLE evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id UUID NOT NULL REFERENCES evaluation_runs(id),
  rule_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL,

  CONSTRAINT evaluation_results_outcome_valid
    CHECK (outcome IN ('pass', 'fail', 'error')),

  CONSTRAINT evaluation_results_rule_unique
    UNIQUE (evaluation_run_id, rule_id)
);

CREATE INDEX evaluation_runs_revision_idx
  ON evaluation_runs (draft_revision_id, created_at DESC);