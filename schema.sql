-- ═══════════════════════════════════════════════════════════════════════════════
-- Microstock Metadata Management Tool — Database Schema
-- Run this in the Supabase SQL Editor (Database → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL DEFAULT '',
  role          VARCHAR(20)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'admin')),
  plan          VARCHAR(20)  NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free', 'pro', 'business')),
  credits       INTEGER      NOT NULL DEFAULT 10,
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Sessions (enables real server-side logout) ─────────────────────────────────
-- Stores a SHA-256 hash of each JWT so that logout truly invalidates the token
-- even before its JWT expiry time.
CREATE TABLE IF NOT EXISTS sessions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64)  NOT NULL UNIQUE,   -- SHA-256 hex of the JWT string
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip_address   VARCHAR(45),
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ── Credit Transactions (audit log) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      INTEGER     NOT NULL,       -- positive = credits added, negative = credits spent
  type        VARCHAR(50) NOT NULL
                CHECK (type IN ('signup_bonus', 'purchase', 'usage', 'admin_grant', 'refund')),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_user_id ON credit_transactions(user_id);

-- ── Subscriptions (schema stub — not activated until payment phase) ───────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan        VARCHAR(20) NOT NULL DEFAULT 'free',
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'cancelled', 'expired', 'pending')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auto-update updated_at on every row change ────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Manual Payments (bKash / Nagad Admin Verification Queue) ──────────────────
CREATE TABLE IF NOT EXISTS manual_payments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan           VARCHAR(20) NOT NULL CHECK (plan IN ('free', 'pro', 'business')),
  amount         INTEGER     NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('bkash', 'nagad')),
  sender_number  VARCHAR(50) NOT NULL,
  trx_id         VARCHAR(100) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_payments_user_id ON manual_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_payments_status  ON manual_payments(status);

