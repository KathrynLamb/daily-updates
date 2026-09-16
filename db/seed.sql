-- db/seed.sql
--
-- Demo data for the local database (npm run local:db).
-- Every name here is made up. Never load real children's data locally.
--
-- The local server lets you act as these users by name:
--   practitioner   records observations, drafts, reviews, evaluates
--   approver       everything above, plus approve and publish
--   parent         reads Ava's published updates only
--   outsider       an approver at a different setting

INSERT INTO settings (id, name)
VALUES
  ('demo-setting', 'Demo Childcare'),
  ('other-setting', 'Another Childcare');

INSERT INTO children (id, setting_id, first_name)
VALUES
  ('demo-ava', 'demo-setting', 'Ava'),
  ('other-sam', 'other-setting', 'Sam');

INSERT INTO app_users (id, identity_issuer, identity_subject)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'local', 'practitioner'),
  ('10000000-0000-4000-8000-000000000002', 'local', 'approver'),
  ('10000000-0000-4000-8000-000000000003', 'local', 'parent'),
  ('10000000-0000-4000-8000-000000000004', 'local', 'outsider');

INSERT INTO setting_memberships (user_id, setting_id, role)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'demo-setting', 'practitioner'),
  ('10000000-0000-4000-8000-000000000002', 'demo-setting', 'approver'),
  ('10000000-0000-4000-8000-000000000004', 'other-setting', 'approver');

INSERT INTO parent_child_access (user_id, child_id)
VALUES
  ('10000000-0000-4000-8000-000000000003', 'demo-ava');