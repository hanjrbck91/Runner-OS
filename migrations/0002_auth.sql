-- Runner OS — Auth.js tables (M07-E, deploy-time).
-- Required by the Nodemailer magic-link flow (verification tokens + optional
-- account/session persistence) when using @auth/drizzle-adapter. Kept separate
-- from the domain schema (0001_init.sql). The domain `users` table is the
-- authority for app userId (resolved by email); these tables serve Auth.js only.
-- Apply AFTER 0001_init.sql. Table shape follows the Auth.js Postgres adapter.

CREATE TABLE IF NOT EXISTS auth_verification_token (
  identifier text NOT NULL,
  token      text NOT NULL,
  expires    timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS auth_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text,
  email          text UNIQUE,
  email_verified timestamptz,
  image          text
);

CREATE TABLE IF NOT EXISTS auth_account (
  user_id             uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  type                text NOT NULL,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token       text,
  access_token        text,
  expires_at          integer,
  token_type          text,
  scope               text,
  id_token            text,
  session_state       text,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS auth_session (
  session_token text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires       timestamptz NOT NULL
);
