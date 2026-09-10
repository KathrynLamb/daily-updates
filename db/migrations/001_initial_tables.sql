CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE children (
  id TEXT PRIMARY KEY,
  setting_id TEXT NOT NULL REFERENCES settings(id),
  first_name TEXT NOT NULL
);

CREATE TABLE observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id TEXT NOT NULL REFERENCES children(id),
  observation_date DATE NOT NULL,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT observations_category_valid
    CHECK (category IN ('activity', 'food', 'sleep', 'general')),

  CONSTRAINT observations_text_length
    CHECK (char_length(text) BETWEEN 1 AND 1000),

  CONSTRAINT observations_text_not_blank
    CHECK (text ~ '[^[:space:]]')
);

CREATE INDEX observations_child_date_idx
  ON observations (child_id, observation_date);