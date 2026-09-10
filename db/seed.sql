INSERT INTO settings (id, name)
VALUES ('demo-setting', 'Demo Childcare');

INSERT INTO children (id, setting_id, first_name)
VALUES ('demo-ava', 'demo-setting', 'Ava');

INSERT INTO observations (
  child_id,
  observation_date,
  category,
  text
)
VALUES (
  'demo-ava',
  '2026-09-10',
  'activity',
  'Painted with sponges.'
);