ALTER TABLE evaluation_runs
  ADD COLUMN content_review_id UUID REFERENCES content_reviews(id);

ALTER TABLE evaluation_results
  DROP CONSTRAINT evaluation_results_outcome_valid;

ALTER TABLE evaluation_results
  ADD CONSTRAINT evaluation_results_outcome_valid
  CHECK (outcome IN ('pass', 'fail', 'error', 'review'));