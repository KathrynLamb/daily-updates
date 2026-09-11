CREATE TABLE evaluation_policies (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  rules JSONB NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  change_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE active_evaluation_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  policy_version INTEGER NOT NULL REFERENCES evaluation_policies(version)
);

INSERT INTO evaluation_policies (version, rules, change_reason)
VALUES (
  1,
  '{"maxCharacters": 1000, "minSources": 1}',
  'Initial basic evaluation rules'
);

INSERT INTO active_evaluation_policy (id, policy_version)
VALUES (1, 1);

ALTER TABLE evaluation_runs
  ADD COLUMN policy_version INTEGER
  REFERENCES evaluation_policies(version);