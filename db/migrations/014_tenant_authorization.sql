-- db/migrations/014_tenant_authorization.sql
--
-- Authentication establishes who someone is.
-- These tables determine what that identity may access.

CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Together these identify one user from an external identity
  -- provider without storing passwords in this application.
  identity_issuer TEXT NOT NULL,
  identity_subject TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,

  CONSTRAINT app_users_identity_issuer_not_blank
    CHECK (identity_issuer ~ '[^[:space:]]'),

  CONSTRAINT app_users_identity_subject_not_blank
    CHECK (identity_subject ~ '[^[:space:]]'),

  CONSTRAINT app_users_external_identity_unique
    UNIQUE (identity_issuer, identity_subject)
);

CREATE TABLE setting_memberships (
  user_id UUID NOT NULL
    REFERENCES app_users(id),

  setting_id TEXT NOT NULL
    REFERENCES settings(id),

  role TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, setting_id),

  CONSTRAINT setting_memberships_role_valid
    CHECK (
      role IN (
        'practitioner',
        'approver',
        'admin'
      )
    )
);

CREATE INDEX setting_memberships_setting_idx
  ON setting_memberships (setting_id, user_id);

CREATE TABLE parent_child_access (
  user_id UUID NOT NULL
    REFERENCES app_users(id),

  child_id TEXT NOT NULL
    REFERENCES children(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, child_id)
);

CREATE INDEX parent_child_access_child_idx
  ON parent_child_access (child_id, user_id);