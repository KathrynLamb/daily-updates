-- db/migrations/009_content_review_coverage.sql
-- Coverage becomes a stored, computed result rather than a model judgement.
--
-- coverage_verdict is derived in application code by set difference over the
-- observation ids, so the id columns are the evidence for it and are stored
-- alongside. coverage_reason stays free text from the model: it explains the
-- ids it chose, and is not what the verdict is read from.

ALTER TABLE content_reviews
  ADD COLUMN covered_observation_ids TEXT[],
  ADD COLUMN missing_observation_ids TEXT[],
  ADD COLUMN unknown_observation_ids TEXT[],
  ADD COLUMN coverage_verdict TEXT,
  ADD COLUMN coverage_reason TEXT;

ALTER TABLE content_reviews
  ADD CONSTRAINT content_reviews_coverage_verdict_valid
  CHECK (coverage_verdict IN ('complete', 'incomplete'));

-- The verdict must agree with the evidence stored next to it. A row where
-- coverage_verdict says complete while ids are missing is a bug, not a state
-- the table should be able to hold.
ALTER TABLE content_reviews
  ADD CONSTRAINT content_reviews_coverage_agrees_with_ids
  CHECK (
    coverage_verdict IS NULL
    OR (
      coverage_verdict = 'complete'
      AND COALESCE(array_length(missing_observation_ids, 1), 0) = 0
    )
    OR (
      coverage_verdict = 'incomplete'
      AND COALESCE(array_length(missing_observation_ids, 1), 0) > 0
    )
  );

-- Extend the existing lifecycle invariant so a completed review cannot be
-- missing its coverage result.
ALTER TABLE content_reviews
  DROP CONSTRAINT content_reviews_state_valid;

ALTER TABLE content_reviews
  ADD CONSTRAINT content_reviews_state_valid CHECK (
    (
      status = 'running'
      AND verdict IS NULL
      AND coverage_verdict IS NULL
      AND covered_observation_ids IS NULL
      AND missing_observation_ids IS NULL
      AND unknown_observation_ids IS NULL
      AND coverage_reason IS NULL
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
      AND (
        (
          rubric_version = 'grounding-v2'
          AND coverage_verdict IS NULL
          AND covered_observation_ids IS NULL
          AND missing_observation_ids IS NULL
          AND unknown_observation_ids IS NULL
          AND coverage_reason IS NULL
        )
        OR
        (
          rubric_version = 'grounding-coverage-v2'
          AND coverage_verdict IS NOT NULL
          AND covered_observation_ids IS NOT NULL
          AND missing_observation_ids IS NOT NULL
          AND unknown_observation_ids IS NOT NULL
          AND coverage_reason IS NOT NULL
        )
      )
    )
    OR
    (
      status = 'error'
      AND verdict IS NULL
      AND coverage_verdict IS NULL
      AND covered_observation_ids IS NULL
      AND missing_observation_ids IS NULL
      AND unknown_observation_ids IS NULL
      AND coverage_reason IS NULL
      AND error_message IS NOT NULL
      AND completed_at IS NOT NULL
    )
  );