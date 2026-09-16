CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL, password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0, phone_verified INTEGER NOT NULL DEFAULT 0,
  mfa_enabled INTEGER NOT NULL DEFAULT 0, mfa_method TEXT,
  totp_secret TEXT, last_totp_step BIGINT NOT NULL DEFAULT -1,
  login_failures INTEGER NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL, stage TEXT NOT NULL, expires_at BIGINT NOT NULL,
  remember_me INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0,
  last_sent BIGINT NOT NULL DEFAULT 0, pending_totp TEXT
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES flows(id),
  channel TEXT NOT NULL, otp_hash TEXT NOT NULL, expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS challenges_flow ON challenges(flow_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  expires_at BIGINT NOT NULL, csrf TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at BIGINT NOT NULL
);
